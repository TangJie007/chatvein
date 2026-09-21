"""对话流水线总图：understand → 按难度进 simple / medium / hard 子图。"""

from __future__ import annotations

from typing import Any, Literal

from langgraph.graph import END, START, StateGraph

from .. import router
from . import medium as medium_mod
from . import simple as simple_mod
from .state import ChatState

DifficultyRoute = Literal["simple", "medium", "hard"]


def _understand(state: ChatState) -> dict[str, Any]:
    text = (state.get("message") or "").strip()
    understood = router.understand(text)
    return {
        "rewritten": str(understood.get("rewritten") or text),
        "difficulty": str(understood.get("difficulty") or "simple"),
        "route_reason": str(understood.get("reason") or ""),
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
    return {
        "reply": result["reply"],
        "selected_tools": result["selected_tools"],
        "tool_plan_reason": result.get("tool_plan_reason"),
        "used_llm": result["used_llm"],
        "tool_trace": result.get("tool_trace") or [],
    }


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
    return {
        "reply": result["reply"],
        "selected_tools": result["selected_tools"],
        "tool_plan_reason": result.get("tool_plan_reason"),
        "used_llm": result["used_llm"],
        "tool_trace": result.get("tool_trace") or [],
    }


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
    """入口：跑总图，返回 ``run_chat`` 所需字段。"""
    text = (message or "").strip()
    out = build_pipeline().invoke(
        {
            "message": text,
            "history": list(history or []),
            "role": role,
        }
    )
    difficulty = str(out.get("difficulty") or "simple")
    return {
        "reply": str(out.get("reply") or ""),
        "rewritten": str(out.get("rewritten") or text),
        "difficulty": difficulty,
        "route": difficulty,
        "route_reason": out.get("route_reason"),
        "selected_tools": list(out.get("selected_tools") or []),
        "tool_plan_reason": out.get("tool_plan_reason"),
        "tool_trace": list(out.get("tool_trace") or []),
        "used_llm": bool(out.get("used_llm")),
    }
