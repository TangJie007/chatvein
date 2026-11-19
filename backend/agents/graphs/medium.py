"""medium 图：tool_selector → ReAct（agent ⇄ tools）循环。"""

from __future__ import annotations

from typing import Any

from langchain_core.messages import BaseMessage, HumanMessage
from langgraph.graph import END, START, StateGraph

from mcps.registry import invoke_tools, resolve_tools  # pyright: ignore[reportImplicitRelativeImport]

from .. import llm as llm_mod
from .. import tool_selector
from ..context import assemble_context
from trace.recording import (
    note,
    record_tools_if_absent,
    span,
    trace_checkpoint,
)

from .common import (
    always_on_tools,
    allowed_from_role,
    build_react_graph,
    concise_failure,
    StepLimitReached,
    invoke_react,
    last_text,
    react_recursion_limit,
    step_limit_reply,
)
from ..cancellation import TurnCancelled  # pyright: ignore[reportImplicitRelativeImport]
from .prompts import MEDIUM_SYSTEM_STATIC, build_agent_system
from .state import ChatState
from .tool_trace import extract_tool_trace

_MEDIUM_SYSTEM = MEDIUM_SYSTEM_STATIC

# medium：工具上限对齐 LangChain 文档；图步数由公式推导，勿再手写偏小常量
_LLM_TIMEOUT = 120.0
_REACT_DEADLINE_S = 300.0
_MAX_MODEL_CALLS = 12  # 略高于工具上限，避免模型先触顶
_MAX_TOOL_CALLS = 10
_MAX_WEB_SEARCH = 3
_RECURSION_LIMIT = react_recursion_limit(_MAX_MODEL_CALLS)  # 12×8+16 = 112


def build_medium_graph(
    *,
    system_prompt: str = _MEDIUM_SYSTEM,
    name: str = "medium_react",
    role: dict[str, Any] | None = None,
):
    """选型 → ReAct 的 medium 子图。"""

    def select_tools_node(state: ChatState) -> dict[str, Any]:
        planned = tool_selector.select_tools(
            state.get("rewritten") or state.get("message") or "",
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
        selected = list(state.get("selected_tools") or [])
        # 常驻工具见 graphs/common.py::always_on_tools：不参与选型 / 白名单，
        # 角色可用 "!工具名" 显式拒绝。
        names = list(dict.fromkeys([*selected, *always_on_tools(role)]))
        tools = resolve_tools(names)
        # 团队模式：挂派发工具（主 agent 把子任务交给成员）。
        # 工具从团队上下文读花名册；未开启团队模式时 role 无 _team_mode，不会挂载。
        # parallel_delegate 走线程池 fan-out（批次 2 §2.4），delegate_to_agent 保留给
        # 「子任务有先后依赖」的串行场景；CHATVEIN_PARALLEL_DELEGATE=0 时只挂后者。
        if (role or {}).get("_team_mode"):
            from agents.delegation import DELEGATE_TOOL  # pyright: ignore[reportImplicitRelativeImport]
            from agents.orchestration import (  # pyright: ignore[reportImplicitRelativeImport]
                PARALLEL_TOOL,
                parallel_enabled,
            )

            tools = [*tools, DELEGATE_TOOL]
            if parallel_enabled():
                tools = [*tools, PARALLEL_TOOL]
        model = llm_mod.get_chat_model(
            role=role,
            timeout=_LLM_TIMEOUT,
        )
        if model is None:
            if not selected:
                reply = f"（离线）{text}" if text else "（离线）未配置 LLM。"
            else:
                reply = invoke_tools(text, selected)
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
                "tool_trace": [],
            }
        try:
            role_prompt = str((role or {}).get("prompt") or "").strip()
            system_prompt = build_agent_system(
                tier="medium",
                role_prompt=role_prompt or None,
            )
            agent = build_react_graph(
                model,
                tools,
                system_prompt=system_prompt,
                name=name,
                max_model_calls=_MAX_MODEL_CALLS,
                max_tool_calls=_MAX_TOOL_CALLS,
                max_web_search=_MAX_WEB_SEARCH,
            )
            # 按 token 预算装配历史：超预算才压缩较早对话，否则原样送入。
            assembled = assemble_context(
                state.get("history"),
                message=text or "请执行工具",
                system_prompt=system_prompt,
                role=role,
                summarizer_model=model,
            )
            messages: list[BaseMessage] = [
                *assembled.messages,
                HumanMessage(content=text or "请执行工具"),
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
                "tool_trace": traced,
            }
        except TurnCancelled:
            # 用户取消必须继续往外抛：落进下面的兜底分支会变成「工具调用失败」
            # 并让本轮继续跑完。
            raise
        except StepLimitReached as exc:
            # 步数触顶：已跑过的工具结果仍然有效，收束给用户而不是整轮报错
            traced = extract_tool_trace(exc.partial.get("messages") or [])
            return {
                "reply": step_limit_reply(exc.partial),
                "used_llm": False,
                "tool_trace": traced,
            }
        except Exception as exc:  # noqa: BLE001
            verbose = invoke_tools(text, selected) if selected else ""
            # 详细工具输出写入追踪，气泡只保留一句话提示（避免把路径/日志铺满聊天框）
            if verbose:
                note(
                    "react_error",
                    name="react_error",
                    status="error",
                    error=f"{type(exc).__name__}: {exc}",
                    detail={
                        "error": f"{type(exc).__name__}: {exc}",
                        "tool_output": verbose,
                    },
                )
            return {
                "reply": concise_failure(exc, verbose),
                "used_llm": False,
                "tool_trace": [],
            }

    graph = StateGraph(ChatState)
    graph.add_node("select_tools", select_tools_node)
    graph.add_node("react", react_node)
    graph.add_edge(START, "select_tools")
    graph.add_edge("select_tools", "react")
    graph.add_edge("react", END)
    return graph.compile(name="medium_pipeline")


def run_medium(
    rewritten: str,
    *,
    used_llm: bool = False,
    history: list[dict[str, Any]] | None = None,
    system_prompt: str = _MEDIUM_SYSTEM,
    name: str = "medium_react",
    role: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """跑 medium 子图，返回 reply / selected_tools / used_llm / tool_trace 等。"""
    out = build_medium_graph(system_prompt=system_prompt, name=name, role=role).invoke(
        {
            "message": rewritten,
            "rewritten": rewritten,
            "used_llm": used_llm,
            "history": list(history or []),
        }
    )
    return {
        "reply": str(out.get("reply") or ""),
        "selected_tools": list(out.get("selected_tools") or []),
        "candidate_tools": list(out.get("candidate_tools") or []),
        "tool_plan_reason": out.get("tool_plan_reason"),
        "used_llm": bool(used_llm or out.get("used_llm")),
        "tool_trace": list(out.get("tool_trace") or []),
    }


MEDIUM_SYSTEM = _MEDIUM_SYSTEM
