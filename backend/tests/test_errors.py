"""批次 4 §4.3：统一错误模型（码表 / 归类 / 对外形状）。"""

from __future__ import annotations

import pytest

import errors
from agents.cancellation import TurnCancelled


class _Status(Exception):
    def __init__(self, message: str, status: int) -> None:
        super().__init__(message)
        self.status_code = status


@pytest.mark.parametrize(
    ("exc", "code", "retryable"),
    [
        (_Status("slow down", 429), errors.MODEL_RATE_LIMIT, True),
        (_Status("forbidden", 403), errors.MODEL_AUTH, False),
        (_Status("no such model", 404), errors.MODEL_NOT_FOUND, False),
        (_Status("gateway boom", 502), errors.MODEL_FAILED, True),
        (TimeoutError("upstream hung"), errors.MODEL_TIMEOUT, True),
        (ConnectionError("reset"), errors.MODEL_FAILED, True),
        (PermissionError("nope"), errors.TOOL_DENIED, False),
        (ValueError("拒绝访问：超出会话目录"), errors.SANDBOX_VIOLATION, False),
        (TurnCancelled(), errors.CANCELLED, False),
        (RuntimeError("boom"), errors.INTERNAL, False),
    ],
)
def test_classify_maps_to_code_and_retryability(
    exc: BaseException, code: str, retryable: bool
) -> None:
    err = errors.classify(exc, stage="llm")
    assert err.code == code
    assert err.retryable is retryable
    assert err.stage == "llm"


def test_rate_limit_wording_and_request_id_survive() -> None:
    exc = _Status("too many requests", 429)
    exc.request_id = "req-123"  # type: ignore[attr-defined]
    err = errors.classify(exc)
    assert "429" in err.message
    assert "req-123" in err.message


def test_status_code_hints_keep_http_text() -> None:
    """老测试与用户都靠「HTTP 403」这串字认原因，改码表时别把它丢掉。

    报文里没有「拒绝 / denied」这类特征时才走状态码分支；有特征会先判成
    ``TOOL_DENIED``（见 ``errors.classify`` 的判定顺序），所以这里用中性报文。
    """
    assert "403" in errors.classify(_Status("forbidden", 403)).message
    assert "500" in errors.classify(_Status("boom", 500)).message
    # 400 不是模型侧故障：不给「模型异常」这种误导文案。
    assert errors.classify(_Status("bad param", 400)).code == errors.INTERNAL


def test_tool_code_attribute_wins() -> None:
    exc = RuntimeError("transient upper limit")
    exc.tool_code = errors.TOOL_TIMEOUT  # type: ignore[attr-defined]
    assert errors.classify(exc).code == errors.TOOL_TIMEOUT


def test_envelope_shape_is_stable() -> None:
    """REST/SSE/trace 三处共用的形状：加字段可以，改名要同步前端 client.ts。"""
    data = errors.AgentError(errors.MODEL_AUTH, stage="chat").to_dict()
    assert set(data) == {"code", "message", "retryable", "stage"}
    assert data["code"] == "MODEL_AUTH"
    assert data["retryable"] is False
    assert "detail" not in data


def test_detail_only_when_asked() -> None:
    err = errors.AgentError(errors.INTERNAL, detail={"raw": "x"})
    assert "detail" not in err.to_dict()
    assert err.to_dict(with_detail=True)["detail"] == {"raw": "x"}


def test_http_detail_keeps_old_contract() -> None:
    """REST 仍要给 ``detail``：老前端没读 ``error`` 也能看到人话。"""
    err = errors.AgentError(errors.TOOL_DENIED)
    assert err.http_detail() == err.message
    assert err.http_status == 403


def test_unknown_code_does_not_leak_traceback() -> None:
    err = errors.AgentError("SOMETHING_NEW")
    assert err.message.startswith("出错了（SOMETHING_NEW）")
    assert "Traceback" not in err.message


def test_internal_message_does_not_embed_raw_text() -> None:
    """``raw`` 里有后端路径，可能还有带 Key 的 URL：只能留在 detail。"""
    err = errors.classify(RuntimeError(r"open failed: C:\Users\me\secret.txt"))
    assert err.code == errors.INTERNAL
    assert "secret.txt" not in err.message
    assert err.detail["raw"].startswith("open failed")


def test_401_wins_over_denied_wording() -> None:
    """中文网关常把 401 写成「未授权」：要判成模型鉴权，别引用户去改工具权限。"""
    err = errors.classify(_Status("未授权访问：denied", 401))
    assert err.code == errors.MODEL_AUTH
    assert err.http_status == 401
