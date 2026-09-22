"""对话流水线总图：understand → 按难度进 simple / medium / hard 子图。"""

from __future__ import annotations

from typing import Any, Literal

from langgraph.graph import END, START, StateGraph

from .. import router
from trace import complete, note, tracing  # pyright: ignore[reportMissingImports]
from . import hard as hard_mod
from . import medium as medium_mod
from . import simple as simple_mod
from .state import ChatState

DifficultyRoute = Literal["simple", "medium", "hard"]

_compiled_pipeline = None


def _merged_system(role: dict[str, Any] | None, base: str) -> str:
    """角色提示叠在能力说明之上，避免丢掉工作区 / 工具约定。"""
    role_prompt = ""
    if role:
        role_prompt = str(role.get("prompt") or "").strip()
    if role_prompt:
        return f"{role_prompt}\n\n{base}"
    return base


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
    system_prompt = _merged_system(role, simple_mod.SIMPLE_SYSTEM)
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
    result = medium_mod.run_medium(
        str(state.get("rewritten") or ""),
        used_llm=bool(state.get("used_llm")),
        history=list(state.get("history") or []),
        name="medium_react",
        role=role,
    )
    return _branch_result(result)


def _hard_node(state: ChatState) -> dict[str, Any]:
    role = state.get("role")
    result = hard_mod.run_hard(
        str(state.get("rewritten") or ""),
        used_llm=bool(state.get("used_llm")),
        history=list(state.get("history") or []),
        name="hard_react",
        role=role,
    )
    branched = _branch_result(result)
    if result.get("plan"):
        branched["plan"] = result["plan"]
    if result.get("verify_reason"):
        branched["verify_reason"] = result["verify_reason"]
    return branched


def build_pipeline():
    """编译总图（进程内缓存；节点在 invoke 时读模块引用，测试 monkeypatch 仍生效）。"""
    global _compiled_pipeline
    if _compiled_pipeline is not None:
        return _compiled_pipeline
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
    _compiled_pipeline = graph.compile(name="chat_pipeline")
    return _compiled_pipeline


def reset_pipeline_cache() -> None:
    """测试用：清空总图缓存。"""
    global _compiled_pipeline
    _compiled_pipeline = None


def run_pipeline(
    message: str,
    *,
    history: list[dict[str, Any]] | None = None,
    role: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """入口：跑总图，返回 ``run_chat`` 所需字段，并附上 ``trace``。"""
    text = (message or "").strip()
    with tracing(text):
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
        result["trace"] = complete(
            difficulty=difficulty,
            rewritten=str(result["rewritten"]),
            route_reason=str(result.get("route_reason") or ""),
            selected_tools=list(result["selected_tools"]),
            candidate_tools=list(result["candidate_tools"]),
            tool_plan_reason=str(result.get("tool_plan_reason") or ""),
            reply=str(result["reply"]),
        ) or {}
        return result
