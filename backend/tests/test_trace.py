"""追踪回调、调用参数，以及独立 trace 服务的落盘。"""

from __future__ import annotations

import json
import sqlite3
from uuid import uuid4

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_core.outputs import ChatGeneration, LLMResult

from agents.graphs.pipeline import run_pipeline
from conversations.service import ConversationsService
from mcps.sandbox import session_db_path
from trace.recording import TraceHandler, note, span, tracing
from trace.service import TraceService
from trace.store import get_turn_trace, list_turn_traces, save_turn_trace


def test_callback_records_request_response_and_tokens() -> None:
    run_id = uuid4()
    with tracing("现在几点", meta={"context_window": 1000}) as recorder:
        handler = TraceHandler(recorder)
        with span("understand"):
            handler.on_chat_model_start(
                {"kwargs": {"api_key": "sk-secret", "max_retries": 2}},
                [[SystemMessage(content="只做路由"), HumanMessage(content="现在几点")]],
                run_id=run_id,
                invocation_params={
                    "model": "demo-model",
                    "temperature": 0,
                    "tools": [
                        {
                            "type": "function",
                            "function": {"name": "web_search", "description": "search"},
                        }
                    ],
                },
            )
            message = AIMessage(
                content='{"difficulty":"simple"}',
                usage_metadata={
                    "input_tokens": 11,
                    "output_tokens": 7,
                    "total_tokens": 18,
                    "input_token_details": {"cache_read": 4},
                    "output_token_details": {"reasoning": 2},
                },
            )
            handler.on_llm_end(
                LLMResult(generations=[[ChatGeneration(message=message)]]),
                run_id=run_id,
            )
        snap = recorder.snapshot()

    span_step = next(step for step in snap["steps"] if step["kind"] == "span")
    step = next(step for step in snap["steps"] if step["kind"] == "llm")
    assert step["name"] == "understand"
    assert step["parent_id"] == span_step["id"]
    assert step["model"] == "demo-model"
    assert step["invocation"]["temperature"] == 0
    assert step["invocation"]["max_retries"] == 2
    assert step["invocation"]["tools"][0]["name"] == "web_search"
    assert "sk-secret" not in json.dumps(snap, ensure_ascii=False)
    assert step["request"]["messages"][0]["content"] == "只做路由"
    assert "simple" in step["response"]["content"]
    assert step["usage"]["input_tokens"] == 11
    assert step["usage"]["cached_tokens"] == 4
    assert step["usage"]["reasoning_tokens"] == 2
    assert step["usage"]["context_pct"] == 1.1
    assert snap["totals"]["total_tokens"] == 18
    assert snap["totals"]["cached_tokens"] == 4
    assert snap["totals"]["llm_calls"] == 1
    assert snap["context_window"] == 1000


def test_llm_error_keeps_status_and_request_id() -> None:
    run_id = uuid4()

    class Boom(Exception):
        status_code = 429
        request_id = "req_1"

    with tracing("hi") as recorder:
        handler = TraceHandler(recorder)
        handler.on_chat_model_start(
            {},
            [[HumanMessage(content="hi")]],
            run_id=run_id,
            invocation_params={"model": "demo"},
        )
        handler.on_llm_error(Boom("slow down"), run_id=run_id)
        step = recorder.steps[0]

    assert step["status"] == "error"
    assert step["error_detail"]["status_code"] == 429
    assert step["error_detail"]["request_id"] == "req_1"


def test_nested_tracing_reuses_the_outer_recorder() -> None:
    with tracing("outer") as outer:
        with tracing("inner") as inner:
            note("route", name="route")
            assert inner is outer
        assert outer.steps[0]["kind"] == "route"
    with tracing("next") as nxt:
        assert nxt.steps == []
        assert nxt is not outer


def test_repeated_run_id_is_not_duplicated() -> None:
    run_id = uuid4()
    with tracing("hi") as recorder:
        handler = TraceHandler(recorder)
        handler.on_chat_model_start(
            {},
            [[HumanMessage(content="hi")]],
            run_id=run_id,
            invocation_params={"model": "demo"},
        )
        handler.on_chat_model_start(
            {},
            [[HumanMessage(content="hi again")]],
            run_id=run_id,
            invocation_params={"model": "demo"},
        )
        handler.on_llm_end(
            LLMResult(generations=[[ChatGeneration(message=AIMessage(content="ok"))]]),
            run_id=run_id,
        )
        assert len(recorder.steps) == 1
        assert recorder.steps[0]["request"]["messages"][0]["content"] == "hi"


def test_offline_pipeline_trace_exposes_route(monkeypatch) -> None:
    monkeypatch.setattr("agents.router.llm_mod.get_chat_model", lambda **_kwargs: None)
    monkeypatch.setattr("agents.graphs.simple.llm_mod.get_chat_model", lambda **_kwargs: None)
    out = run_pipeline("你好")
    trace = out["trace"]
    assert trace["status"] == "done"
    assert trace["difficulty"] == "simple"
    assert trace["path"][2]["id"] == "simple"
    assert trace["path"][2]["taken"] is True
    assert trace["path"][3]["taken"] is False
    kinds = [step["kind"] for step in trace["steps"]]
    assert "route" in kinds
    assert any(step.get("status") == "offline" for step in trace["steps"])


def test_turn_trace_roundtrip_keeps_created_at(tmp_path) -> None:
    db = tmp_path / "logs" / "session.sqlite"
    payload = {
        "input": "你好",
        "difficulty": "simple",
        "elapsed_ms": 12,
        "selected_tools": [],
        "steps": [],
        "totals": {
            "input_tokens": 1,
            "output_tokens": 2,
            "total_tokens": 3,
            "llm_calls": 1,
            "tool_calls": 0,
        },
    }
    save_turn_trace(db, "turn-1", payload)
    with sqlite3.connect(db) as conn:
        conn.execute(
            "UPDATE turn_traces SET created_at = ? WHERE turn_id = ?",
            ("2000-01-01T00:00:00+00:00", "turn-1"),
        )
    save_turn_trace(db, "turn-1", {**payload, "elapsed_ms": 99})
    listed = list_turn_traces(db)
    assert listed[0]["turn_id"] == "turn-1"
    assert listed[0]["created_at"] == "2000-01-01T00:00:00+00:00"
    assert listed[0]["status"] == "done"
    assert listed[0]["totals"]["total_tokens"] == 3
    assert listed[0]["elapsed_ms"] == 99
    full = get_turn_trace(db, "turn-1")
    assert full is not None
    assert full["difficulty"] == "simple"


def test_trace_service_lists_a_conversation_turn() -> None:
    conversations = ConversationsService()
    conversation_id, _, _ = conversations.save_exchange(None, "hi", "hello", turn_id="t1")
    stored = conversations.get_conversation(conversation_id)
    assert stored is not None
    db = session_db_path(conversations.workspace_root_for(stored["workspace_dir"]))
    save_turn_trace(
        db,
        "t1",
        {
            "input": "hi",
            "difficulty": "medium",
            "elapsed_ms": 40,
            "selected_tools": ["web_search"],
            "steps": [{"kind": "llm", "name": "understand"}],
            "totals": {
                "input_tokens": 4,
                "output_tokens": 6,
                "total_tokens": 10,
                "llm_calls": 1,
                "tool_calls": 0,
            },
        },
    )
    service = TraceService()
    listed = service.list_traces(conversation_id)
    assert listed is not None
    assert listed[0]["turn_id"] == "t1"
    assert listed[0]["difficulty"] == "medium"
    detail = service.get_trace(conversation_id, "t1")
    assert detail is not None
    assert detail["steps"][0]["name"] == "understand"
    assert service.get_trace(conversation_id, "missing") is None
    assert service.list_traces("missing") is None
