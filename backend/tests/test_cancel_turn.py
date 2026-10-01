"""真·取消：turn_id 注册表、检查点抛出、以及追踪的 cancelled 终态。"""

from __future__ import annotations

import pytest

from agents.cancellation import (
    TurnCancelled,
    bind_turn,
    cancel_probe,
    cancel_turn,
    clear_turn,
    current_turn_id,
    is_cancelled,
    raise_if_cancelled,
)
from agents.graphs.common import cancellation_guards
from trace.recording import span, tracing


@pytest.fixture(autouse=True)
def _unbound_turn():
    """每个用例结束都解绑，避免 ContextVar 泄漏到别的用例。"""
    yield
    bind_turn(None)


def test_registry_binds_cancels_and_clears() -> None:
    bind_turn("t1")
    assert current_turn_id() == "t1"
    assert is_cancelled() is False
    # 未绑定的轮次互不影响
    assert is_cancelled("other") is False

    assert cancel_turn("t1") is True
    assert is_cancelled() is True
    assert cancel_probe()() is True

    clear_turn("t1")
    assert is_cancelled() is False
    # 空 id 不受理
    assert cancel_turn("") is False


def test_unbound_thread_never_cancels() -> None:
    """没绑定 turn_id 的线程（如后台任务）不该被取消误伤。"""
    bind_turn(None)
    cancel_turn("someone-else")
    raise_if_cancelled()  # 不抛
    assert cancel_probe()() is False
    clear_turn("someone-else")


def test_raise_if_cancelled_closes_the_trace_as_cancelled() -> None:
    bind_turn("t2")
    cancel_turn("t2")
    with tracing("帮我扣图") as recorder:
        recorder.open_span("react")
        with pytest.raises(TurnCancelled):
            raise_if_cancelled()
        # 抛之前已把本轮收尾：终态不能停在 running（否则面板永远「进行中」）
        assert recorder.status == "cancelled"
        running = [step for step in recorder.steps if step["status"] == "running"]
        assert running == []
        assert recorder.steps[0]["status"] == "cancelled"

    # 退出 tracing 后不会被改成 done
    assert recorder.status == "cancelled"
    clear_turn("t2")


def test_guards_abort_before_model_and_tool() -> None:
    tool_guard, model_guard = cancellation_guards()
    bind_turn("t3")

    # 未取消：正常放行（工具交给 handler 执行）
    assert tool_guard.wrap_tool_call(None, lambda request: "ran") == "ran"
    model_guard.before_model({}, None)

    cancel_turn("t3")
    with pytest.raises(TurnCancelled):
        model_guard.before_model({}, None)
    with pytest.raises(TurnCancelled):
        tool_guard.wrap_tool_call(None, lambda request: "ran")
    clear_turn("t3")


def test_cancelled_span_is_closed_by_recorder() -> None:
    """取消发生在 span 内部时，span 也要收尾，不能一直挂着。"""
    bind_turn("t4")
    cancel_turn("t4")
    with tracing("hi") as recorder:
        try:
            with span("react"):
                raise_if_cancelled()
        except TurnCancelled:
            pass
        assert all(step["status"] != "running" for step in recorder.steps)
        # span 跟着整轮标 cancelled，而不是显示成「失败」
        assert recorder.steps[0]["status"] == "cancelled"
    clear_turn("t4")
