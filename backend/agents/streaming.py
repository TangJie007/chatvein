"""SSE 事件桥：工作线程推事件，异步路由消费。

为什么用 ContextVar：``run_pipeline`` 在 ``asyncio.to_thread`` 里同步执行，
节点 / 中间件没有机会拿到路由层的队列对象；ContextVar 跟随线程上下文
（trace / sandbox 用的是同一套机制），写入方不需要层层传参。

线程安全：``StreamSink.push`` 只做 ``loop.call_soon_threadsafe(queue.put_nowait)``，
真正的 ``asyncio.Queue`` 操作全部回到事件循环线程。
"""

from __future__ import annotations

import os
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any, Iterator

_sink: ContextVar[StreamSink | None] = ContextVar("chatvein_stream_sink", default=None)


def stream_enabled() -> bool:
    """``CHATVEIN_STREAM=0`` 一键回落到非流式。"""
    raw = os.environ.get("CHATVEIN_STREAM")
    if raw is None:
        return True
    return raw.strip().lower() not in {"0", "false", "no", "off", ""}


class StreamSink:
    """把事件安全地投递给 ``asyncio.Queue``（事件循环里由 SSE generator 消费）。"""

    def __init__(self, queue: Any, loop: Any) -> None:
        self._queue = queue
        self._loop = loop
        self._closed = False

    def push(self, event: str, data: dict[str, Any] | None = None) -> None:
        if self._closed:
            return
        try:
            self._loop.call_soon_threadsafe(
                self._queue.put_nowait, {"event": event, "data": data or {}}
            )
        except RuntimeError:
            # 事件循环已关闭（前端断开 / 服务退出）：静默丢弃，不拖垮工作线程。
            self._closed = True

    def token(self, text: str) -> None:
        if text:
            self.push("token", {"text": text})

    def tool(
        self,
        name: str,
        status: str,
        *,
        tool_call_id: str = "",
        detail: str = "",
    ) -> None:
        payload: dict[str, Any] = {
            "name": name,
            "status": status,
            "tool_call_id": tool_call_id,
        }
        if detail:
            payload["detail"] = detail
        self.push("tool", payload)

    def stage(self, node: str) -> None:
        self.push("trace", {"node": node})

    def close(self) -> None:
        self._closed = True


@contextmanager
def bind_stream_sink(sink: StreamSink | None) -> Iterator[StreamSink | None]:
    token = _sink.set(sink)
    try:
        yield sink
    finally:
        _sink.reset(token)


def current_sink() -> StreamSink | None:
    return _sink.get()


def emit_token(text: str) -> None:
    sink = _sink.get()
    if sink is not None:
        sink.token(text)


def emit_tool(name: str, status: str, *, tool_call_id: str = "", detail: str = "") -> None:
    sink = _sink.get()
    if sink is not None:
        sink.tool(name, status, tool_call_id=tool_call_id, detail=detail)


def emit_stage(node: str) -> None:
    sink = _sink.get()
    if sink is not None:
        sink.stage(node)


def message_text(message: Any) -> str:
    """从 ``AIMessageChunk`` / ``AIMessage`` 抽纯文本（兼容 content block 列表）。"""
    content = getattr(message, "content", None)
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict) and block.get("type") == "text":
                parts.append(str(block.get("text") or ""))
        return "".join(parts)
    return ""


__all__ = [
    "StreamSink",
    "bind_stream_sink",
    "current_sink",
    "emit_stage",
    "emit_token",
    "emit_tool",
    "message_text",
    "stream_enabled",
]
