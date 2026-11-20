"""simple 图：单节点直答（无工具、无 ReAct 循环）。"""

from __future__ import annotations

from typing import Any

from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage
from langgraph.graph import END, START, MessagesState, StateGraph

from errors import classify

from .. import llm as llm_mod
from ..context import assemble_context
from ..streaming import emit_token, message_text, stream_enabled
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


def _stream_simple(
    model: Any,
    messages: list[BaseMessage],
    partial: list[str] | None = None,
) -> str:
    """逐块推 token；模型不支持流式（或抛错）由调用方回落 invoke。

    ``partial`` 记录已经推给用户的内容：调用方据此判断还能不能换模型重跑——
    已经吐过字就重跑会同一句说两遍。
    """
    chunks = partial if partial is not None else []
    for chunk in model.stream(messages, config=runnable_config()):
        delta = message_text(chunk)
        if delta:
            emit_token(delta)
            chunks.append(delta)
    return "".join(chunks).strip()


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
        # 按 token 预算装配历史：超预算才压缩较早对话，否则原样送入。
        assembled = assemble_context(
            history,
            message=text or "你好",
            system_prompt=system_prompt,
            role=role,
            summarizer_model=model,
        )
        messages: list[BaseMessage] = [
            *assembled.messages,
            HumanMessage(content=text or "你好"),
        ]
        with span("simple"):
            if stream_enabled():
                partial: list[str] = []
                try:
                    reply = _stream_simple(model, messages, partial)
                except Exception as exc:  # noqa: BLE001
                    if partial:
                        # 已经吐字：重跑会重复，原样抛给外层（错误条会带「再试一次」）
                        raise
                    # 还没吐字：先试备用模型，再回落到一次性 invoke。这是唯一
                    # 能安全换线的地方（正文流中途换模型会混增量）。
                    model = llm_mod.try_fallback(model, exc) or model
                    out = build_simple_graph(
                        model, system_prompt=system_prompt
                    ).invoke({"messages": messages}, config=runnable_config())
                    reply = last_text(out.get("messages"))
            else:
                out = build_simple_graph(model, system_prompt=system_prompt).invoke(
                    {"messages": messages},
                    config=runnable_config(),
                )
                reply = last_text(out.get("messages"))
        if reply:
            return reply, True
        return "（无文本回复）", True
    except Exception as exc:  # noqa: BLE001
        # 原文只进追踪（可能含后端路径 / 网关报文），气泡里给码表的人话。
        err = classify(exc, stage="simple")
        note("llm", name="simple", status="error", detail={"code": err.code})
        return f"直接回答失败：{err.message}", False
