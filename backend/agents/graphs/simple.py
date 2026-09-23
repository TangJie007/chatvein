"""simple 图：单节点直答（无工具、无 ReAct 循环）。"""

from __future__ import annotations

from typing import Any

from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage
from langgraph.graph import END, START, MessagesState, StateGraph

from .. import llm as llm_mod
from ..memory import to_lc_messages
from trace.recording import note, runnable_config, span

from .common import last_text

_SYSTEM = "你是 ChatVein 助手，用中文简洁回答。可参考上文对话上下文。"

SIMPLE_SYSTEM = _SYSTEM


def build_simple_graph(model: Any, *, system_prompt: str = _SYSTEM):
    """编译一张仅含 ``chat`` 节点的图。"""

    def chat(state: MessagesState) -> dict[str, Any]:
        resp = model.invoke([SystemMessage(content=system_prompt), *state["messages"]])
        return {"messages": [resp]}

    graph = StateGraph(MessagesState)
    graph.add_node("chat", chat)
    graph.add_edge(START, "chat")
    graph.add_edge("chat", END)
    return graph.compile(name="simple_chat")


def run_simple(
    text: str,
    *,
    history: list[dict[str, Any]] | None = None,
    system_prompt: str = _SYSTEM,
    role: dict[str, Any] | None = None,
) -> tuple[str, bool]:
    """跑 simple 图；无主模型时离线回落。"""
    model = llm_mod.get_chat_model(role=role)
    if model is None:
        reply = f"（离线）{text}" if text else "（离线）未配置 LLM。"
        note(
            "llm",
            name="simple",
            status="offline",
            response={"content": reply, "tool_calls": []},
            detail={"reason": "未配置模型"},
        )
        return reply, False
    try:
        prior = to_lc_messages(history)
        messages: list[BaseMessage] = [*prior, HumanMessage(content=text or "你好")]
        with span("simple"):
            out = build_simple_graph(model, system_prompt=system_prompt).invoke(
                {"messages": messages},
                config=runnable_config(),
            )
        reply = last_text(out.get("messages"))
        if reply:
            return reply, True
        return "（无文本回复）", True
    except Exception as exc:  # noqa: BLE001
        return f"直接回答失败: {exc}", False
