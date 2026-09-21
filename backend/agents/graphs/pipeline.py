"""对话流水线总图：understand → 按难度进 simple / medium / hard 子图。"""

from __future__ import annotations

from typing import Any, Literal

from langgraph.graph import END, START, StateGraph

from .. import router
from . import medium as medium_mod
from . import simple as simple_mod
from .state import ChatState

_HARD_SYSTEM = (
    "你是 ChatVein 助手，处理较复杂的本机任务。"
    "先在内部理清步骤，再按需多次调用工具（文件 / 联网 / 知识库 / 只读 SQL / 代码沙箱 / "
    "Bash 或 PowerShell / 浏览器），交叉核对后再用中文总结回答。不要编造工具结果；"
    "写文件前确认路径在工作区内。"
    "用 Python 解决问题时：在当前会话工作区创建虚拟环境，把代码写成 .py，执行，"
    "阅读 stdout 和 stderr，失败就修改后再跑，不要在没有成功执行结果时声称已解决。"
    "操作网页时先 snapshot 再按 ref 交互。"
)

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
    reply, ran = simple_mod.run_simple(str(state.get("rewritten") or ""))
    return {
        "reply": reply,
        "used_llm": bool(state.get("used_llm") or ran),
        "selected_tools": [],
        "tool_plan_reason": None,
    }


def _medium_node(state: ChatState) -> dict[str, Any]:
    result = medium_mod.run_medium(
        str(state.get("rewritten") or ""),
        used_llm=bool(state.get("used_llm")),
        system_prompt=medium_mod.MEDIUM_SYSTEM,
        name="medium_react",
    )
    return {
        "reply": result["reply"],
        "selected_tools": result["selected_tools"],
        "tool_plan_reason": result.get("tool_plan_reason"),
        "used_llm": result["used_llm"],
    }


def _hard_node(state: ChatState) -> dict[str, Any]:
    # hard 仍走选型 + ReAct，system 更强调多步核对（独立图名便于后续拆分）
    result = medium_mod.run_medium(
        str(state.get("rewritten") or ""),
        used_llm=bool(state.get("used_llm")),
        system_prompt=_HARD_SYSTEM,
        name="hard_react",
    )
    return {
        "reply": result["reply"],
        "selected_tools": result["selected_tools"],
        "tool_plan_reason": result.get("tool_plan_reason"),
        "used_llm": result["used_llm"],
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


def run_pipeline(message: str) -> dict[str, Any]:
    """入口：跑总图，返回 ``run_chat`` 所需字段。"""
    text = (message or "").strip()
    out = build_pipeline().invoke({"message": text})
    difficulty = str(out.get("difficulty") or "simple")
    return {
        "reply": str(out.get("reply") or ""),
        "rewritten": str(out.get("rewritten") or text),
        "difficulty": difficulty,
        "route": difficulty,
        "route_reason": out.get("route_reason"),
        "selected_tools": list(out.get("selected_tools") or []),
        "tool_plan_reason": out.get("tool_plan_reason"),
        "used_llm": bool(out.get("used_llm")),
    }
