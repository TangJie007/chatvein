"""工具韧性层：分类、重试、熔断、幂等、取消优先。"""

from __future__ import annotations

import pytest
from langchain_core.messages import ToolMessage

from agents.cancellation import (
    TurnCancelled,
    bind_turn,
    cancel_turn,
    clear_turn,
)
from agents.graphs.common import resilient_tool_middleware
from mcps.resilience import (
    TurnState,
    classify_exception,
    execute_tool_call,
    max_attempts,
    tool_retry_enabled,
)
from mcps.tool_result import (
    TOOL_CIRCUIT_OPEN,
    TOOL_FAILED,
    TOOL_OK,
    TOOL_TRANSIENT_EXHAUSTED,
    ToolResult,
)


@pytest.fixture(autouse=True)
def _fast_retry(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CHATVEIN_TOOL_RETRY_BASE", "0")
    monkeypatch.setenv("CHATVEIN_TOOL_MAX_ATTEMPTS", "3")
    monkeypatch.setenv("CHATVEIN_TOOL_CB_THRESHOLD", "3")


def test_classify_exception() -> None:
    assert classify_exception(TimeoutError("slow")) == "transient"
    assert classify_exception(ConnectionError("reset")) == "transient"
    assert classify_exception(PermissionError("nope")) == "denied"
    assert classify_exception(ValueError("拒绝访问：超出会话目录")) == "denied"
    assert classify_exception(ValueError("bad param")) == "deterministic"
    assert classify_exception(TurnCancelled("t")) == "cancelled"


def test_retry_transient_then_success() -> None:
    calls: list[int] = []

    def invoke() -> str:
        calls.append(1)
        if len(calls) < 3:
            raise TimeoutError("upstream timeout")
        return "答案"

    result = execute_tool_call(
        tool_name="web_search", call_id="c1", invoke=invoke, state=TurnState()
    )
    assert result.ok is True
    assert result.content == "答案"
    assert result.attempts == 3
    assert len(calls) == 3


def test_transient_exhausted_is_reported() -> None:
    def invoke() -> str:
        raise ConnectionError("network down")

    result = execute_tool_call(
        tool_name="web_search", call_id="c2", invoke=invoke, state=TurnState()
    )
    assert result.ok is False
    assert result.code == TOOL_TRANSIENT_EXHAUSTED
    assert result.error_kind == "transient"
    assert result.retryable is True
    assert "失败" in result.content


def test_deterministic_failure_is_not_retried() -> None:
    calls: list[int] = []

    def invoke() -> str:
        calls.append(1)
        raise ValueError("bad param")

    result = execute_tool_call(
        tool_name="read_file", call_id="c3", invoke=invoke, state=TurnState()
    )
    assert result.ok is False
    assert result.code == TOOL_FAILED
    assert len(calls) == 1


def test_side_effect_tools_never_retry() -> None:
    calls: list[int] = []

    def invoke() -> str:
        calls.append(1)
        raise TimeoutError("shell timeout")

    result = execute_tool_call(
        tool_name="bash_run", call_id="c4", invoke=invoke, state=TurnState()
    )
    assert result.ok is False
    assert len(calls) == 1


def test_circuit_opens_after_consecutive_failures() -> None:
    state = TurnState()
    for index in range(3):
        result = execute_tool_call(
            tool_name="kb_search",
            call_id=f"f{index}",
            invoke=lambda: (_ for _ in ()).throw(ValueError("bad")),
            state=state,
        )
        assert result.ok is False

    called: list[int] = []
    blocked = execute_tool_call(
        tool_name="kb_search",
        call_id="f3",
        invoke=lambda: called.append(1) or "ok",
        state=state,
    )
    assert blocked.code == TOOL_CIRCUIT_OPEN
    assert called == []
    assert "熔断" in blocked.content


def test_circuit_resets_after_success() -> None:
    state = TurnState()
    assert (
        execute_tool_call(
            tool_name="kb_search",
            call_id="a",
            invoke=lambda: (_ for _ in ()).throw(ValueError("x")),
            state=state,
        ).ok
        is False
    )
    assert (
        execute_tool_call(
            tool_name="kb_search", call_id="b", invoke=lambda: "ok", state=state
        ).ok
        is True
    )
    assert (
        execute_tool_call(
            tool_name="kb_search",
            call_id="c",
            invoke=lambda: (_ for _ in ()).throw(ValueError("x")),
            state=state,
        ).ok
        is False
    )
    # 成功后计数被清零：再失败一次不应直接熔断。
    assert "kb_search" not in state.opened


def test_idempotent_tool_cached_by_call_id() -> None:
    calls: list[int] = []
    state = TurnState()

    def invoke() -> str:
        calls.append(1)
        return "已写入"

    first = execute_tool_call(
        tool_name="write_file", call_id="same-id", invoke=invoke, state=state
    )
    second = execute_tool_call(
        tool_name="write_file", call_id="same-id", invoke=invoke, state=state
    )
    assert first.content == second.content == "已写入"
    assert len(calls) == 1


def test_retry_disabled_returns_single_attempt(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CHATVEIN_TOOL_RETRY", "0")
    assert tool_retry_enabled() is False
    assert resilient_tool_middleware() == []

    calls: list[int] = []

    def invoke() -> str:
        calls.append(1)
        raise TimeoutError("x")

    result = execute_tool_call(
        tool_name="web_search", call_id="d", invoke=invoke, state=TurnState()
    )
    assert len(calls) == 1
    assert result.ok is False


def test_cancel_interrupts_backoff(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CHATVEIN_TOOL_RETRY_BASE", "5")
    bind_turn("turn-cancel")
    cancel_turn("turn-cancel")
    try:
        with pytest.raises(TurnCancelled):
            execute_tool_call(
                tool_name="web_search",
                call_id="e",
                invoke=lambda: (_ for _ in ()).throw(ConnectionError("reset")),
                state=TurnState(),
            )
    finally:
        clear_turn("turn-cancel")
        bind_turn(None)


def test_turn_cancelled_is_not_swallowed() -> None:
    with pytest.raises(TurnCancelled):
        execute_tool_call(
            tool_name="web_search",
            call_id="f",
            invoke=lambda: (_ for _ in ()).throw(TurnCancelled("t")),
            state=TurnState(),
        )


def test_explicit_tool_code_wins_over_string_guessing() -> None:
    """外部 MCP 失败自带错误码：必须原样上报，且不再按 transient 重试。"""
    from mcps.external.adapter import ExternalToolError

    calls: list[int] = []

    def invoke() -> str:
        calls.append(1)
        raise ExternalToolError("server down", tool_code="MCP_SERVER_DOWN")

    result = execute_tool_call(
        tool_name="mcp__remote__search", call_id="mcp-1", invoke=invoke, state=TurnState()
    )
    assert result.ok is False
    assert result.code == "MCP_SERVER_DOWN"
    assert result.retryable is False
    assert len(calls) == 1


def test_resilient_middleware_wraps_tool_message() -> None:
    middleware = resilient_tool_middleware()
    assert len(middleware) == 1
    wrap = getattr(middleware[0], "wrap_tool_call")
    request = type(
        "Req",
        (),
        {"tool_call": {"name": "web_search", "args": {"query": "x"}, "id": "call-1"}},
    )()
    message = wrap(request, lambda _req: ToolMessage(content="结果", tool_call_id="call-1"))
    assert isinstance(message, ToolMessage)
    assert message.content == "结果"
    assert message.status == "success"
    assert message.additional_kwargs["tool_result"]["code"] == TOOL_OK


def test_tool_result_dict_is_serializable() -> None:
    data = ToolResult(ok=False, content="x", code=TOOL_FAILED, error_kind="deterministic").to_dict()
    assert data["ok"] is False
    assert data["code"] == TOOL_FAILED
    assert data["error_kind"] == "deterministic"


def test_max_attempts_bounds() -> None:
    assert 1 <= max_attempts() <= 5
