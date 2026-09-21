"""追踪回调与会话库落盘。"""

from __future__ import annotations

from uuid import uuid4

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_core.outputs import ChatGeneration, LLMResult

from agents.graphs.pipeline import run_pipeline
from agents.trace import TraceHandler, span, tracing
from conversations.service import ConversationsService
from conversations.session_store import ensure_session_db, get_turn_trace, list_turn_traces, save_turn_trace


def test_callback_records_request_response_and_tokens() -> None:
    run_id = uuid4()
    with tracing("现在几点") as recorder:
        handler = TraceHandler(recorder)
        with span("understand"):
            handler.on_chat_model_start(
                {},
                [[SystemMessage(content="只做路由"), HumanMessage(content="现在几点")]],
                run_id=run_id,
                invocation_params={"model": "demo-model"},
            )
            message = AIMessage(
                content='{"difficulty":"simple"}',
                usage_metadata={"input_tokens": 11, "output_tokens": 7, "total_tokens": 18},
            )
            handler.on_llm_end(
                LLMResult(generations=[[ChatGeneration(message=message)]]),
                run_id=run_id,
            )
        snap = recorder.snapshot()

    step = snap["steps"][0]
    assert step["kind"] == "llm"
    assert step["name"] == "understand"
    assert step["model"] == "demo-model"
    assert step["request"]["messages"][0]["content"] == "只做路由"
    assert "simple" in step["response"]["content"]
    assert step["usage"]["input_tokens"] == 11
    assert step["usage"]["output_tokens"] == 7
    assert snap["totals"]["total_tokens"] == 18
    assert snap["totals"]["llm_calls"] == 1


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
    assert trace["difficulty"] == "simple"
    assert trace["path"][2]["id"] == "simple"
    assert trace["path"][2]["taken"] is True
    assert trace["path"][3]["taken"] is False
    kinds = [step["kind"] for step in trace["steps"]]
    assert "route" in kinds
    assert any(step.get("status") == "offline" for step in trace["steps"])


def test_turn_trace_roundtrip(tmp_path) -> None:
    db = tmp_path / "logs" / "session.sqlite"
    ensure_session_db(db)
    save_turn_trace(
        db,
        "turn-1",
        {
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
        },
    )
    listed = list_turn_traces(db)
    assert listed[0]["turn_id"] == "turn-1"
    assert listed[0]["totals"]["total_tokens"] == 3
    assert listed[0]["input"] == "你好"
    full = get_turn_trace(db, "turn-1")
    assert full is not None
    assert full["difficulty"] == "simple"


def test_record_turn_persists_trace_for_the_window() -> None:
    service = ConversationsService()
    conversation_id, _, _ = service.save_exchange(None, "hi", "hello", turn_id="t1")
    stored = service.get_conversation(conversation_id)
    assert stored is not None
    service.record_turn(
        stored["workspace_dir"],
        user_text="hi",
        reply_text="hello",
        turn_id="t1",
        trace={
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
    listed = service.list_traces(conversation_id)
    assert listed is not None
    assert listed[0]["turn_id"] == "t1"
    assert listed[0]["difficulty"] == "medium"
    detail = service.get_trace(conversation_id, "t1")
    assert detail is not None
    assert detail["steps"][0]["name"] == "understand"
    assert service.get_trace(conversation_id, "missing") is None
    assert service.list_traces("missing") is None
