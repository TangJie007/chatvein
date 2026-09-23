"""medium 图：tool_selector → ReAct（agent ⇄ tools）循环。"""

from __future__ import annotations

from typing import Any

from langchain_core.messages import BaseMessage, HumanMessage
from langgraph.graph import END, START, StateGraph

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
    allowed_from_role,
    build_react_graph,
    invoke_react,
    last_text,
    react_recursion_limit,
)
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
_RECURSION_LIMIT = react_recursion_limit(_MAX_MODEL_CALLS)  # 2×12+10 = 34


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
        names = list(state.get("selected_tools") or [])
        # 本轮启用了技能：把 load_skill 无条件挂进工具列表（技能目录已注入
        # role prompt，模型据此按需调用加载完整正文），不受角色工具白名单过滤。
        if (role or {}).get("_skill_slugs"):
            names = list(dict.fromkeys([*names, "load_skill"]))
        tools = resolve_tools(names)
        model = llm_mod.get_chat_model(
            role=role,
            timeout=_LLM_TIMEOUT,
        )
        if model is None:
            if not names:
                reply = f"（离线）{text}" if text else "（离线）未配置 LLM。"
            else:
                reply = run_tools(text, names)
            note(
                "llm",
                name="react",
                status="offline",
                response={"content": reply, "tool_calls": []},
                detail={
                    "reason": (
                        "未配置模型且无需工具"
                        if not names
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
            agent = build_react_graph(
                model,
                tools,
                system_prompt=build_agent_system(
                    tier="medium",
                    role_prompt=role_prompt or None,
                ),
                name=name,
                max_model_calls=_MAX_MODEL_CALLS,
                max_tool_calls=_MAX_TOOL_CALLS,
                max_web_search=_MAX_WEB_SEARCH,
            )
            prior = to_lc_messages(state.get("history"))
            messages: list[BaseMessage] = [
                *prior,
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
        except Exception as exc:  # noqa: BLE001
            fallback = run_tools(text, names) if names else ""
            suffix = f"\n{fallback}" if fallback else ""
            return {
                "reply": f"工具调用失败({exc}){suffix}",
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
