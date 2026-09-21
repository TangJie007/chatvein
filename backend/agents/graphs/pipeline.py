"""对话流水线总图：understand → 按难度进 simple / medium / hard 子图。"""

from __future__ import annotations

from typing import Any, Literal

from langgraph.graph import END, START, StateGraph

from .. import router
from ..trace import note, tracing
from . import medium as medium_mod
from . import simple as simple_mod
from .state import ChatState

DifficultyRoute = Literal["simple", "medium", "hard"]


def _understand(state: ChatState) -> dict[str, Any]:
    text = (state.get("message") or "").strip()
    understood = router.understand(text)
    rewritten = str(understood.get("rewritten") or text)
    difficulty = str(understood.get("difficulty") or "simple")
    reason = str(understood.get("reason") or "")
    note(
        "route",
        name="route",
        detail={
            "difficulty": difficulty,
            "reason": reason,
            "rewritten": rewritten,
            "used_llm": bool(understood.get("used_llm")),
        },
    )
    return {
        "rewritten": rewritten,
        "difficulty": difficulty,
        "route_reason": reason,
        "used_llm": bool(understood.get("used_llm")),
    }


def _route(state: ChatState) -> DifficultyRoute:
    d = str(state.get("difficulty") or "simple")
    if d == "hard":
        return "hard"
    if d == "medium":
        return "medium"
    return "simple"


def _simple_node(state: ChatState) -> dict[str, Any]:
    role = state.get("role")
    system_prompt = (role or {}).get("prompt") or simple_mod.SIMPLE_SYSTEM
    reply, ran = simple_mod.run_simple(
        str(state.get("rewritten") or ""),
        history=list(state.get("history") or []),
        system_prompt=system_prompt,
        role=role,
    )
    return {
        "reply": reply,
        "used_llm": bool(state.get("used_llm") or ran),
        "selected_tools": [],
        "tool_plan_reason": None,
        "tool_trace": [],
    }


def _branch_result(result: dict[str, Any]) -> dict[str, Any]:
    return {
        "reply": result["reply"],
        "selected_tools": list(result.get("selected_tools") or []),
        "candidate_tools": list(result.get("candidate_tools") or []),
        "tool_plan_reason": result.get("tool_plan_reason"),
        "used_llm": result["used_llm"],
        "tool_trace": result.get("tool_trace") or [],
    }


def _medium_node(state: ChatState) -> dict[str, Any]:
    role = state.get("role")
    system_prompt = (role or {}).get("prompt") or medium_mod.MEDIUM_SYSTEM
    result = medium_mod.run_medium(
        str(state.get("rewritten") or ""),
        used_llm=bool(state.get("used_llm")),
        history=list(state.get("history") or []),
        system_prompt=system_prompt,
        name="medium_react",
        role=role,
    )
    return _branch_result(result)


def _hard_node(state: ChatState) -> dict[str, Any]:
    role = state.get("role")
    system_prompt = (role or {}).get("prompt") or medium_mod.HARD_SYSTEM
    result = medium_mod.run_medium(
        str(state.get("rewritten") or ""),
        used_llm=bool(state.get("used_llm")),
        history=list(state.get("history") or []),
        system_prompt=system_prompt,
        name="hard_react",
        role=role,
    )
    return _branch_result(result)


def build_pipeline():
    """编译总图。"""
    graph = StateGraph(ChatState)
    graph.add_node("understand", _understand)
    graph.add_node("simple", _simple_node)
    graph.add_node("medium", _medium_node)
    graph.add_node("hard", _hard_node)
    graph.add_edge(START, "understand")
    graph.add_conditional_edges(
        "understand",
        _route,
        {
            "simple": "simple",
            "medium": "medium",
            "hard": "hard",
        },
    )
    graph.add_edge("simple", END)
    graph.add_edge("medium", END)
    graph.add_edge("hard", END)
    return graph.compile(name="chat_pipeline")


def run_pipeline(
    message: str,
    *,
    history: list[dict[str, Any]] | None = None,
    role: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """入口：跑总图，返回 ``run_chat`` 所需字段，并附上 ``trace``。"""
    text = (message or "").strip()
    with tracing(text) as recorder:
        out = build_pipeline().invoke(
            {
                "message": text,
                "history": list(history or []),
                "role": role,
            }
        )
        difficulty = str(out.get("difficulty") or "simple")
        result = {
            "reply": str(out.get("reply") or ""),
            "rewritten": str(out.get("rewritten") or text),
            "difficulty": difficulty,
            "route": difficulty,
            "route_reason": out.get("route_reason"),
            "selected_tools": list(out.get("selected_tools") or []),
            "candidate_tools": list(out.get("candidate_tools") or []),
            "tool_plan_reason": out.get("tool_plan_reason"),
            "tool_trace": list(out.get("tool_trace") or []),
            "used_llm": bool(out.get("used_llm")),
        }
        recorder.apply_outcome(
            difficulty=difficulty,
            rewritten=str(result["rewritten"]),
            route_reason=str(result.get("route_reason") or ""),
            selected_tools=list(result["selected_tools"]),
            candidate_tools=list(result["candidate_tools"]),
            tool_plan_reason=str(result.get("tool_plan_reason") or ""),
            reply=str(result["reply"]),
        )
        result["trace"] = recorder.snapshot()
        return result
