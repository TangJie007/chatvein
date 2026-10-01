"""模型供应商限流（429 / TPM·RPM 超限）的识别、退避重试与可读提示。"""

from __future__ import annotations

import pytest

from agents import llm as llm_mod
from agents.cancellation import bind_turn, cancel_turn, clear_turn
from agents.llm import (
    TurnCancelled,
    call_with_rate_limit_retry,
    describe_model_error,
    is_rate_limit_error,
    model_error_hint,
)


class Boom(Exception):
    def __init__(self, message: str, status: int | None = None) -> None:
        super().__init__(message)
        if status is not None:
            self.status_code = status
            self.body = {"request_id": "req-abc"}


@pytest.fixture(autouse=True)
def _no_wait(monkeypatch):
    """退避等待改成瞬时，便于测试连续失败的行为。"""
    slept: list[float] = []
    monkeypatch.setattr(llm_mod.time, "sleep", lambda s: slept.append(s))
    return slept


def test_recognizes_rate_limit_by_status_and_by_message() -> None:
    assert is_rate_limit_error(Boom("boom", status=429))
    # 报文说明轮询配额超了，但没透传 status_code 的网关
    assert is_rate_limit_error(
        Boom("Error code: 429 - {'error': {'message': 'inference exceeds tpm/rpm limit'}}")
    )
    assert is_rate_limit_error(Boom("Rate limit reached for requests"))
    assert not is_rate_limit_error(Boom("bad request", status=400))
    assert not is_rate_limit_error(Boom("connection reset"))


def test_model_error_hint_is_readable_and_carries_request_id() -> None:
    hint = model_error_hint(Boom("Error code: 429", status=429))
    assert hint is not None
    assert "限流" in hint
    assert "req-abc" in hint
    assert "403" in (model_error_hint(Boom("nope", status=403)) or "")
    assert "500" in (model_error_hint(Boom("nope", status=500)) or "")
    # 认不出来的错误不冒充专家：交给调用方兜底
    assert model_error_hint(Boom("boom", status=400)) is None
    assert "工具调用失败" in describe_model_error(Boom("boom", status=400))


def test_retry_stops_on_rate_limit_then_succeeds() -> None:
    calls: list[int] = []

    def fn() -> str:
        calls.append(1)
        if len(calls) < 3:
            raise Boom("inference exceeds tpm/rpm limit", status=429)
        return "ok"

    assert call_with_rate_limit_retry(fn) == "ok"
    assert len(calls) == 3


def test_retry_gives_up_and_raises_original_error() -> None:
    calls: list[int] = []

    def fn() -> str:
        calls.append(1)
        raise Boom("inference exceeds tpm/rpm limit", status=429)

    with pytest.raises(Boom):
        call_with_rate_limit_retry(fn)
    # 首次 + 3 次重试
    assert len(calls) == 4


def test_non_rate_limit_error_is_not_retried() -> None:
    calls: list[int] = []

    def fn() -> str:
        calls.append(1)
        raise Boom("invalid api key", status=401)

    with pytest.raises(Boom):
        call_with_rate_limit_retry(fn)
    assert len(calls) == 1


def test_backoff_can_be_cancelled() -> None:
    bind_turn("t-rl")
    cancel_turn("t-rl")
    calls: list[int] = []

    def fn() -> str:
        calls.append(1)
        raise Boom("inference exceeds tpm/rpm limit", status=429)

    # 退避窗口里用户点停止：立即收尾而不是干等配额
    with pytest.raises(TurnCancelled):
        call_with_rate_limit_retry(fn)
    assert len(calls) == 1
    clear_turn("t-rl")
    bind_turn(None)
