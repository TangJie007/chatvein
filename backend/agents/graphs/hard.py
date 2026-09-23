"""hard 图：plan → select_tools → ReAct → verify（可回环再执行）。

与 medium 的差异：
- 先结构化规划（目标 / 步骤 / 成功标准）
- ReAct 递归上限更高，并把计划注入 system
- 结束后用结构化核对决定是否再跑一轮；回环累计 tool_trace
"""

from __future__ import annotations

from typing import Any, Literal

from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage
from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel, Field

from mcps import resolve_tools, run_tools  # pyright: ignore[reportImplicitRelativeImport]

from .. import llm as llm_mod
from .. import tool_selector
from ..memory import to_lc_messages
from trace.recording import (
    note,
    record_tools_if_absent,
    span,
    trace_checkpoint,
)

from .common import (
    ALWAYS_ON_TOOLS,
    allowed_from_role,
    build_react_graph,
    invoke_react,
    last_text,
    merge_tool_traces,
    react_recursion_limit,
)
from .prompts import HARD_SYSTEM_STATIC, build_agent_system
from .state import ChatState
from .tool_trace import extract_tool_trace

_HARD_SYSTEM = HARD_SYSTEM_STATIC

_MAX_VERIFY_ROUNDS = 2
_LLM_TIMEOUT = 120.0
_REACT_DEADLINE_S = 420.0
# 工具上限对齐 LangChain 文档示例；图步数 = 2×模型上限 + 余量
_MAX_MODEL_CALLS = 16
_MAX_TOOL_CALLS = 10
_MAX_WEB_SEARCH = 3
_RECURSION_LIMIT = react_recursion_limit(_MAX_MODEL_CALLS)  # 2×16+10 = 42


class TaskPlan(BaseModel):
    goal: str = Field(description="本轮要完成的目标（中文）")
    steps: list[str] = Field(
        default_factory=list,
        description="有序执行步骤，每步一句",
    )
    success_criteria: list[str] = Field(
        default_factory=list,
        description="如何判定已完成（可核对的标准）",
    )
    risks: list[str] = Field(
        default_factory=list,
        description="可能卡点或需要交叉验证之处",
    )


class VerifyDecision(BaseModel):
    passed: bool = Field(description="是否已满足成功标准")
    reason: str = Field(description="核对结论的简短理由")
    missing: list[str] = Field(
        default_factory=list,
        description="仍未满足的标准或缺口",
    )
    next_focus: str = Field(
        default="",
        description="若未通过，下一轮应优先补什么",
    )


def _format_plan(plan: dict[str, Any] | None) -> str:
    if not plan:
        return ""
    goal = str(plan.get("goal") or "").strip()
    steps = [str(s).strip() for s in (plan.get("steps") or []) if str(s).strip()]
    criteria = [
        str(s).strip() for s in (plan.get("success_criteria") or []) if str(s).strip()
    ]
    risks = [str(s).strip() for s in (plan.get("risks") or []) if str(s).strip()]
    lines = ["【执行计划】"]
    if goal:
        lines.append(f"目标：{goal}")
    if steps:
        lines.append("步骤：")
        lines.extend(f"{i}. {s}" for i, s in enumerate(steps, 1))
    if criteria:
        lines.append("成功标准：")
        lines.extend(f"- {c}" for c in criteria)
    if risks:
        lines.append("风险：")
        lines.extend(f"- {r}" for r in risks)
    return "\n".join(lines)


def _default_plan(text: str, *, risk: str | None = None) -> dict[str, Any]:
    plan: dict[str, Any] = {
        "goal": text or "完成用户请求",
        "steps": ["按需调用工具", "汇总结果"],
        "success_criteria": ["给出可核对的中文结论"],
        "risks": [risk] if risk else [],
    }
    return plan


def build_hard_graph(
    *,
    system_prompt: str = _HARD_SYSTEM,
    name: str = "hard_react",
    role: dict[str, Any] | None = None,
):
    """选型前规划、执行后核对的 hard 子图。"""

    def plan_node(state: ChatState) -> dict[str, Any]:
        text = (state.get("rewritten") or state.get("message") or "").strip()
        model = llm_mod.get_chat_model(
            temperature=0, role=role, streaming=False, thinking=False
        )
        if model is None:
            plan = _default_plan(text)
            note(
                "llm",
                name="plan",
                status="offline",
                response={"content": _format_plan(plan), "tool_calls": []},
                detail={"reason": "未配置模型，使用默认计划"},
            )
            return {
                "plan": plan,
                "plan_text": _format_plan(plan),
                "verify_round": 0,
                "used_llm": bool(state.get("used_llm")),
            }
        try:
            with span("plan"):
                decision = llm_mod.invoke_structured(
                    model,
                    TaskPlan,
                    [
                        SystemMessage(
                            content=(
                                "你是任务规划模块。根据用户意图给出可执行计划，"
                                "不回答问题本身。步骤要具体、可核对；不要臆造用户未提的需求。"
                            )
                        ),
                        HumanMessage(content=text or "(空消息)"),
                    ],
                )
            plan = {
                "goal": (decision.goal or "").strip() or text,
                "steps": [s.strip() for s in decision.steps if s and str(s).strip()],
                "success_criteria": [
                    s.strip()
                    for s in decision.success_criteria
                    if s and str(s).strip()
                ],
                "risks": [s.strip() for s in decision.risks if s and str(s).strip()],
            }
            if not plan["steps"]:
                plan["steps"] = ["按需调用工具完成目标", "用中文总结并标注来源"]
            if not plan["success_criteria"]:
                plan["success_criteria"] = ["目标已落实，结论可核对"]
            plan_text = _format_plan(plan)
            note("route", name="plan", detail={"plan": plan})
            return {
                "plan": plan,
                "plan_text": plan_text,
                "verify_round": 0,
                "used_llm": True,
            }
        except Exception as exc:  # noqa: BLE001
            plan = _default_plan(text, risk=f"规划失败: {exc}")
            return {
                "plan": plan,
                "plan_text": _format_plan(plan),
                "verify_round": 0,
                "used_llm": bool(state.get("used_llm")),
            }

    def select_tools_node(state: ChatState) -> dict[str, Any]:
        base = (state.get("rewritten") or state.get("message") or "").strip()
        plan_text = str(state.get("plan_text") or "")
        focus = str(state.get("verify_focus") or "").strip()
        query = base
        if plan_text:
            query = f"{base}\n\n{plan_text}"
        if focus:
            query = f"{query}\n\n上一轮核对未通过，请优先补：{focus}"
        planned = tool_selector.select_tools(
            query,
            allowed=allowed_from_role(role),
            role=role,
        )
        used = bool(state.get("used_llm")) or bool(planned.get("used_llm"))
        selected = list(planned.get("selected_tools") or [])
        candidates = list(planned.get("candidate_tools") or [])
        reason = str(planned.get("tool_plan_reason") or "")
        note(
            "tools",
            name="select_tools",
            detail={
                "selected_tools": selected,
                "candidate_tools": candidates,
                "reason": reason,
                "used_llm": bool(planned.get("used_llm")),
            },
        )
        return {
            "selected_tools": selected,
            "candidate_tools": candidates,
            "tool_plan_reason": reason,
            "used_llm": used,
        }

    def react_node(state: ChatState) -> dict[str, Any]:
        text = (state.get("rewritten") or state.get("message") or "").strip()
        plan_text = str(state.get("plan_text") or "")
        focus = str(state.get("verify_focus") or "").strip()
        user_blob = text
        if plan_text:
            user_blob = f"{text}\n\n{plan_text}"
        if focus:
            user_blob = f"{user_blob}\n\n请针对缺口补做：{focus}"

        selected = list(state.get("selected_tools") or [])
        # 常驻工具：不参与 select_tools 选型 / 角色白名单过滤，无条件挂进工具列表。
        # （技能目录已注入 role prompt，模型按需调用 load_skill；sandbox_run_python
        #  同 load_skill 一样始终可用，调用失败时工具会返回引导信息；get_current_time
        #  让时间类问题无需选型命中、也无需角色勾选 core 分组即可拿到准确时间。）
        names = list(dict.fromkeys([*selected, *ALWAYS_ON_TOOLS]))
        tools = resolve_tools(names)
        model = llm_mod.get_chat_model(
            role=role,
            timeout=_LLM_TIMEOUT,
        )
        role_prompt = str((role or {}).get("prompt") or "").strip()
        prompt = build_agent_system(
            tier="hard",
            role_prompt=role_prompt or None,
            plan_text=plan_text or None,
        )
        prior_trace = list(state.get("tool_trace") or [])

        if model is None:
            if not selected:
                reply = f"（离线）{user_blob}" if user_blob else "（离线）未配置 LLM。"
            else:
                reply = run_tools(user_blob, selected)
            note(
                "llm",
                name="react",
                status="offline",
                response={"content": reply, "tool_calls": []},
                detail={
                    "reason": (
                        "未配置模型且无需工具"
                        if not selected
                        else "未配置模型，改为直接执行筛选出的工具"
                    )
                },
            )
            return {
                "reply": reply,
                "used_llm": False,
                "tool_trace": prior_trace,
            }
        try:
            agent = build_react_graph(
                model,
                tools,
                system_prompt=prompt,
                name=name,
                max_model_calls=_MAX_MODEL_CALLS,
                max_tool_calls=_MAX_TOOL_CALLS,
                max_web_search=_MAX_WEB_SEARCH,
            )
            prior = to_lc_messages(state.get("history"))
            messages: list[BaseMessage] = [
                *prior,
                HumanMessage(content=user_blob or "请执行工具"),
            ]
            with span("react"):
                mark = trace_checkpoint()
                out = invoke_react(
                    agent,
                    {"messages": messages},
                    recursion_limit=_RECURSION_LIMIT,
                    deadline_s=_REACT_DEADLINE_S,
                )
                out_messages = out.get("messages") or []
                reply = last_text(out_messages) or "工具调用完成，但无文本回复。"
                traced = extract_tool_trace(out_messages)
                record_tools_if_absent(mark, traced)
            return {
                "reply": reply,
                "used_llm": True,
                "tool_trace": merge_tool_traces(prior_trace, traced),
            }
        except Exception as exc:  # noqa: BLE001
            fallback = run_tools(user_blob, selected) if selected else ""
            suffix = f"\n{fallback}" if fallback else ""
            return {
                "reply": f"工具调用失败({exc}){suffix}",
                "used_llm": False,
                "tool_trace": prior_trace,
            }

    def verify_node(state: ChatState) -> dict[str, Any]:
        reply = str(state.get("reply") or "")
        plan = state.get("plan") if isinstance(state.get("plan"), dict) else {}
        criteria = [
            str(c).strip()
            for c in (plan.get("success_criteria") or [])
            if str(c).strip()
        ]
        trace = state.get("tool_trace") or []
        round_n = int(state.get("verify_round") or 0) + 1
        model = llm_mod.get_chat_model(
            temperature=0, role=role, streaming=False, thinking=False
        )

        if model is None:
            passed = bool(reply.strip())
            reason = "离线：有回复即视为通过" if passed else "离线：无回复"
            note(
                "llm",
                name="verify",
                status="offline",
                response={"content": reason, "tool_calls": []},
                detail={"passed": passed, "reason": reason},
            )
            return {
                "verify_passed": passed,
                "verify_reason": reason,
                "verify_focus": "",
                "verify_round": round_n,
            }

        tool_summary = (
            "\n".join(
                f"- {t.get('tool_name')}: {str(t.get('result_text') or '')[:400]}"
                for t in trace
                if isinstance(t, dict)
            )
            or "(无工具调用)"
        )
        criteria_text = (
            "\n".join(f"- {c}" for c in criteria) or "- 给出可核对的中文结论"
        )
        try:
            with span("verify"):
                verdict = llm_mod.invoke_structured(
                    model,
                    VerifyDecision,
                    [
                        SystemMessage(
                            content=(
                                "你是结果核对模块。对照成功标准与工具轨迹，判断任务是否真正完成。"
                                "不要因为口吻自信就判通过；缺少证据或产物路径时应判未通过。"
                                "只输出结构化字段。"
                            )
                        ),
                        HumanMessage(
                            content=(
                                f"目标：{plan.get('goal') or ''}\n"
                                f"成功标准：\n{criteria_text}\n\n"
                                f"助手回复：\n{reply[:6000]}\n\n"
                                f"工具轨迹摘要：\n{tool_summary}"
                            )
                        ),
                    ],
                )
            passed = bool(verdict.passed)
            if not passed and round_n >= _MAX_VERIFY_ROUNDS:
                passed = True
                reason = (
                    f"{verdict.reason}；已达核对上限({_MAX_VERIFY_ROUNDS})，收束当前结果"
                )
                focus = ""
            else:
                reason = (verdict.reason or "").strip() or (
                    "通过" if passed else "未通过"
                )
                focus = "" if passed else (verdict.next_focus or "").strip()
                if not passed and not focus and verdict.missing:
                    focus = "；".join(str(m) for m in verdict.missing if m)

            note(
                "route",
                name="verify",
                detail={
                    "passed": passed,
                    "reason": reason,
                    "missing": list(verdict.missing or []),
                    "next_focus": focus,
                    "round": round_n,
                },
            )
            return {
                "verify_passed": passed,
                "verify_reason": reason,
                "verify_focus": focus,
                "verify_round": round_n,
                "used_llm": True,
            }
        except Exception as exc:  # noqa: BLE001
            return {
                "verify_passed": True,
                "verify_reason": f"核对失败({exc})，采用当前回复",
                "verify_focus": "",
                "verify_round": round_n,
            }

    def after_verify(state: ChatState) -> Literal["select_tools", "end"]:
        if state.get("verify_passed"):
            return "end"
        if int(state.get("verify_round") or 0) >= _MAX_VERIFY_ROUNDS:
            return "end"
        return "select_tools"

    graph = StateGraph(ChatState)
    graph.add_node("plan", plan_node)
    graph.add_node("select_tools", select_tools_node)
    graph.add_node("react", react_node)
    graph.add_node("verify", verify_node)
    graph.add_edge(START, "plan")
    graph.add_edge("plan", "select_tools")
    graph.add_edge("select_tools", "react")
    graph.add_edge("react", "verify")
    graph.add_conditional_edges(
        "verify",
        after_verify,
        {
            "select_tools": "select_tools",
            "end": END,
        },
    )
    return graph.compile(name="hard_pipeline")


def run_hard(
    rewritten: str,
    *,
    used_llm: bool = False,
    history: list[dict[str, Any]] | None = None,
    system_prompt: str = _HARD_SYSTEM,
    name: str = "hard_react",
    role: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """跑 hard 子图，返回 reply / selected_tools / used_llm / tool_trace / plan 等。"""
    out = build_hard_graph(system_prompt=system_prompt, name=name, role=role).invoke(
        {
            "message": rewritten,
            "rewritten": rewritten,
            "used_llm": used_llm,
            "history": list(history or []),
            "verify_round": 0,
            "tool_trace": [],
        }
    )
    return {
        "reply": str(out.get("reply") or ""),
        "selected_tools": list(out.get("selected_tools") or []),
        "candidate_tools": list(out.get("candidate_tools") or []),
        "tool_plan_reason": out.get("tool_plan_reason"),
        "used_llm": bool(used_llm or out.get("used_llm")),
        "tool_trace": list(out.get("tool_trace") or []),
        "plan": out.get("plan"),
        "verify_reason": out.get("verify_reason"),
        "verify_passed": bool(out.get("verify_passed")),
    }


HARD_SYSTEM = _HARD_SYSTEM
