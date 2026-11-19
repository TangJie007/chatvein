"""SSE 流式：事件序列、线程桥、取消收尾与开关降级。"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any
from unittest.mock import patch

from starlette.requests import Request

import main
from agents.cancellation import TurnCancelled
from agents.streaming import StreamSink, bind_stream_sink, stream_enabled
from main import ChatRequest


def _request(disconnected: bool = False) -> Request:
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": "/api/chat/stream",
        "raw_path": b"/api/chat/stream",
        "query_string": b"",
        "root_path": "",
        "headers": [],
        "client": ("testclient", 50000),
        "server": ("testserver", 80),
    }
    request = Request(scope)

    async def _is_disconnected() -> bool:
        return disconnected

    request.is_disconnected = _is_disconnected  # type: ignore[method-assign]
    return request


def _prep() -> dict[str, Any]:
    return {
        "early": None,
        "req": ChatRequest(conversation_id="c-1", message="hi"),
        "prepared": {"id": "c-1", "workspace_dir": "ws"},
        "role_runtime": None,
        "turn_id": "t-1",
        "db_path": Path("C:/tmp/stream.db"),
        "history": [],
        "thread_id": "c-1:t-1",
    }


def _frames(chunks: list[str]) -> list[tuple[str, dict[str, Any]]]:
    out: list[tuple[str, dict[str, Any]]] = []
    for chunk in chunks:
        for block in chunk.split("\n\n"):
            if not block.strip() or block.startswith(":"):
                continue
            event = ""
            data = ""
            for line in block.splitlines():
                if line.startswith("event: "):
                    event = line[len("event: ") :]
                elif line.startswith("data: "):
                    data = line[len("data: ") :]
            out.append((event, json.loads(data) if data else {}))
    return out


async def _drain(agen) -> list[str]:
    return [chunk async for chunk in agen]


def _run_stream(
    monkeypatch,
    heavy,
    *,
    disconnected: bool = False,
) -> list[tuple[str, dict[str, Any]]]:
    payload = {"reply": "你好", "turn_id": "t-1", "conversation_id": "c-1"}
    with (
        patch.object(main, "_prepare_chat_turn", return_value=_prep()),
        patch.object(main, "_run_chat_heavy", side_effect=heavy),
        patch.object(main, "_persist_turn", return_value=payload),
    ):
        chunks = asyncio.run(
            _drain(main._stream_events(_prep()["req"], _request(disconnected)))
        )
    return _frames(chunks)


def test_stream_emits_stage_token_tool_and_done(monkeypatch) -> None:
    def heavy(req, prepared, role, turn_id, db_path, history, thread_id, sink):
        assert sink is not None
        sink.push("trace", {"node": "understand"})
        sink.push("trace", {"node": "simple"})
        sink.token("你")
        sink.token("好")
        sink.tool("web_search", "running", tool_call_id="call-1")
        sink.tool("web_search", "ok", tool_call_id="call-1")
        return {"result": {"reply": "你好"}, "tokens": 3, "duration_ms": 5}

    events = _run_stream(monkeypatch, heavy)
    names = [event for event, _ in events]
    assert names == ["trace", "trace", "token", "token", "tool", "tool", "done"]
    assert "".join(data["text"] for event, data in events if event == "token") == "你好"
    done = events[-1][1]
    assert done["reply"] == "你好"
    assert done["conversation_id"] == "c-1"


def test_stream_turns_cancel_into_cancelled_event(monkeypatch) -> None:
    def heavy(*_args, **_kwargs):
        raise TurnCancelled("用户停止")

    events = _run_stream(monkeypatch, heavy)
    assert events[0][0] == "cancelled"
    assert events[0][1]["turn_id"] == "t-1"


def test_stream_early_path_returns_done_only(monkeypatch) -> None:
    prep = {"early": {"reply": "暂未给角色配置模型", "turn_id": "t-1"}}
    with patch.object(main, "_prepare_chat_turn", return_value=prep):
        chunks = asyncio.run(_drain(main._stream_events(_prep()["req"], _request())))
    events = _frames(chunks)
    assert [event for event, _ in events] == ["done"]
    assert events[0][1]["reply"] == "暂未给角色配置模型"


def test_stream_switch_off(monkeypatch) -> None:
    monkeypatch.setenv("CHATVEIN_STREAM", "0")
    assert stream_enabled() is False
    monkeypatch.setenv("CHATVEIN_STREAM", "1")
    assert stream_enabled() is True


def test_sink_is_thread_safe_bridge(monkeypatch) -> None:
    """工作线程推送 → 事件循环收到：这正是 to_thread 的用法。"""
    import queue
    import threading

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    q: queue.Queue = queue.Queue()
    try:

        class _Loop:
            @staticmethod
            def call_soon_threadsafe(fn, *args):
                fn(*args)

        sink = StreamSink(q, _Loop())
        thread = threading.Thread(target=lambda: [sink.token("a"), sink.token("b")])
        thread.start()
        thread.join()
        assert [q.get_nowait()["data"]["text"] for _ in range(2)] == ["a", "b"]
    finally:
        loop.close()
        asyncio.set_event_loop(None)


def test_bind_stream_sink_context(monkeypatch) -> None:
    monkeypatch.setenv("CHATVEIN_STREAM", "1")

    class _Sink:
        def __init__(self) -> None:
            self.events: list[tuple[str, dict[str, Any]]] = []

        def push(self, event: str, data: dict[str, Any] | None = None) -> None:
            self.events.append((event, data or {}))

        def token(self, text: str) -> None:
            self.push("token", {"text": text})

        def tool(self, name: str, status: str, **kwargs: Any) -> None:
            self.push("tool", {"name": name, "status": status})

        def stage(self, node: str) -> None:
            self.push("trace", {"node": node})

    sink = _Sink()
    with bind_stream_sink(sink):  # type: ignore[arg-type]
        from agents.streaming import emit_stage, emit_token, emit_tool

        emit_token("x")
        emit_tool("t", "ok")
        emit_stage("simple")
        assert [event for event, _ in sink.events] == ["token", "tool", "trace"]
