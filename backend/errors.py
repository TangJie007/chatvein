"""统一错误模型（batch4 · 4.3）。

一次失败在四个地方各写一遍文案的时代结束了：模型侧判定（``agents/llm.py``）、
工具侧重试（``mcps/resilience.py``）、气泡兜底（``agents/graphs/common.py``）、
HTTP / SSE 出口（``main.py``）都从这里取「码 + 人话 + 是否可重试 + 出错的阶段」。

三个用法，别混：

- 抛错：``raise AgentError(MODEL_RATE_LIMIT)`` 或 ``raise classify(exc, stage="llm")``；
- 判类：``classify(exc).code``（原来的 ``is_rate_limit_error`` / ``classify_exception`` 已改成它的薄封装）；
- 出口：``to_dict()`` 写 SSE 帧 / trace；``http_detail()`` 兜 REST 的 ``detail`` 字段。

码表是**闭集**：新错误一律先在这里登记，前端 ``src/api/client.ts`` 靠码决定动作，
不再靠中文子串匹配（只要用户改了措辞就会静默失效）。
"""

from __future__ import annotations

from typing import Any, Final

# --- 模型侧 -----------------------------------------------------------------
MODEL_AUTH: Final = "MODEL_AUTH"
MODEL_CONFIG: Final = "MODEL_CONFIG"
MODEL_RATE_LIMIT: Final = "MODEL_RATE_LIMIT"
MODEL_TIMEOUT: Final = "MODEL_TIMEOUT"
MODEL_NOT_FOUND: Final = "MODEL_NOT_FOUND"
MODEL_FAILED: Final = "MODEL_FAILED"

# --- 工具侧（与 ``mcps/tool_result.py`` 同名，那边已改为从这里 re-export） ---
TOOL_OK: Final = "TOOL_OK"
TOOL_FAILED: Final = "TOOL_FAILED"
TOOL_DENIED: Final = "TOOL_DENIED"
TOOL_TIMEOUT: Final = "TOOL_TIMEOUT"
TOOL_TRANSIENT_EXHAUSTED: Final = "TOOL_TRANSIENT_EXHAUSTED"
TOOL_CIRCUIT_OPEN: Final = "TOOL_CIRCUIT_OPEN"
TOOL_SKIPPED: Final = "TOOL_SKIPPED"
MCP_SERVER_DOWN: Final = "MCP_SERVER_DOWN"

# --- 沙箱 / 执行 -------------------------------------------------------------
SANDBOX_VIOLATION: Final = "SANDBOX_VIOLATION"

# --- 流程侧 -----------------------------------------------------------------
CHECKPOINT_EXPIRED: Final = "CHECKPOINT_EXPIRED"
CANCELLED: Final = "CANCELLED"
EVAL_CASE_INVALID: Final = "EVAL_CASE_INVALID"
INTERNAL: Final = "INTERNAL"
#: 流式入口被关（``CHATVEIN_STREAM=0``）：前端据此**回落到非流式**，不是失败。
STREAM_DISABLED: Final = "STREAM_DISABLED"

#: 码 → 给用户看的一句话。``{status_suffix}`` / ``{rid_suffix}`` 由 ``_render`` 填，
#: 没有值就填空串（不要写成「HTTP None」）。改文案只改这里。
MESSAGES: Final[dict[str, str]] = {
    MODEL_RATE_LIMIT: (
        "模型供应商限流（HTTP 429）：本轮请求超过该模型的 TPM/RPM 配额，"
        "已自动退避重试仍未通过。请稍后再试，或在「模型」里换额度更宽的模型。{rid_suffix}"
    ),
    MODEL_AUTH: "模型鉴权失败{status_suffix}：请检查该模型的 Key 是否有效、是否有此模型权限。{rid_suffix}",
    MODEL_NOT_FOUND: "模型不可访问{status_suffix}：请核对模型 ID 与网关地址。{rid_suffix}",
    MODEL_TIMEOUT: "模型调用超时{status_suffix}：网络或网关响应过慢，可重试或换模型。{rid_suffix}",
    MODEL_FAILED: "模型服务端异常{status_suffix}：供应商侧暂时不可用，可稍后重试。{rid_suffix}",
    MODEL_CONFIG: "模型未配置或配置不完整：请在「模型」里补齐地址、Key 与模型 ID。",
    TOOL_DENIED: "工具调用被拒绝：本次操作不在允许范围内，可在「设置 → 权限」调整规则。",
    TOOL_FAILED: "工具调用失败。",
    TOOL_TIMEOUT: "工具调用超时：外部服务长时间无响应，可稍后重试。",
    TOOL_TRANSIENT_EXHAUSTED: "工具重试已用尽：上游服务持续不稳定，可稍后重试。",
    TOOL_CIRCUIT_OPEN: "工具暂时熔断：同一工具本轮连续失败，已停止继续调用。",
    TOOL_SKIPPED: "工具未执行（已跳过）。",
    MCP_SERVER_DOWN: "外部 MCP 服务未连接：请在「设置 → MCP」里重连后再试。",
    SANDBOX_VIOLATION: "操作越出会话沙箱范围：本次已拦截，请在会话目录内操作。",
    CHECKPOINT_EXPIRED: "中断现场已失效：需要重新生成这一轮。",
    CANCELLED: "已取消本次生成。",
    EVAL_CASE_INVALID: "评测用例不合法：请检查 cases 文件里的字段与类型。",
    # 不要把 {raw} 放进 message：它会被塞进 REST 的 detail 与 SSE 帧，等于把
    # 后端路径 / URL / 可能的密钥给用户。原文留在本模块的 detail，只进日志与 trace。
    INTERNAL: "内部错误：这一步没有跑通，可重试；连续失败请到「追踪」面板查看该轮详情。",
    STREAM_DISABLED: "流式已关闭（CHATVEIN_STREAM=0），请使用 /api/chat",
}

#: 码 → 是否值得再试一次。只有「等一会儿大概率能好」的才为 True：
#: 鉴权 / 配置 / 沙箱越界重试多少次都一样，重试只会拖慢用户。
RETRYABLE: Final[dict[str, bool]] = {
    MODEL_RATE_LIMIT: True,
    MODEL_TIMEOUT: True,
    MODEL_FAILED: True,
    TOOL_TIMEOUT: True,
}

#: 码 → REST 出口的 HTTP 状态。只在本模块抛出的错误上用得到（controller 里
#: 手写的 404/400 不在此列）。
HTTP_STATUS: Final[dict[str, int]] = {
    MODEL_AUTH: 401,
    MODEL_CONFIG: 400,
    MODEL_NOT_FOUND: 404,
    MODEL_RATE_LIMIT: 429,
    MODEL_TIMEOUT: 504,
    MODEL_FAILED: 502,
    TOOL_DENIED: 403,
    SANDBOX_VIOLATION: 403,
    EVAL_CASE_INVALID: 400,
    CHECKPOINT_EXPIRED: 410,
    CANCELLED: 409,
    STREAM_DISABLED: 409,
}

#: 报文特征（小写比较）：网关措辞五花八门，状态码未必透传，所以两者都判。
_RATE_LIMIT_MARKERS: Final = (
    "rate limit",
    "rate_limit",
    "rate-limit",
    "ratelimit",
    "too many requests",
    "quota",
    "tpm",
    "rpm",
    "429",
)
_TIMEOUT_MARKERS: Final = ("timeout", "timed out", "超时")
_CONNECT_MARKERS: Final = (
    "connection",
    "connect",
    "transport",
    "network",
    "httpx",
    "unreachable",
    "eof",
)
#: 沙箱越界优先于普通拒绝：两者都算「不让执行」，但给人看的下一步不一样。
_SANDBOX_MARKERS: Final = ("越界", "超出会话目录", "sandbox", "沙箱")
_DENIED_MARKERS: Final = ("拒绝", "不允许", "未授权", "denied", "not allowed")


class _Fields(dict):
    """``str.format_map`` 的兜底：模板里出现未提供的键就当空串，绝不抛 KeyError。"""

    def __missing__(self, key: str) -> str:  # noqa: D105
        return ""


def _status_code(exc: BaseException) -> int | None:
    """从异常上挖 HTTP 状态码：SDK 有的挂 ``status_code``，有的埋在 ``response``。"""
    status = getattr(exc, "status_code", None)
    response = getattr(exc, "response", None)
    if status is None and response is not None:
        status = getattr(response, "status_code", None)
    try:
        return int(status) if status is not None else None
    except (TypeError, ValueError):
        return None


def _request_id(exc: BaseException) -> str:
    """顺手捞供应商的 request_id，方便用户拿去找客服对账。"""
    for source in (getattr(exc, "request_id", None), getattr(exc, "body", None)):
        if isinstance(source, str) and source.strip():
            return source.strip()
        if isinstance(source, dict):
            found = source.get("request_id") or source.get("id")
            if found:
                return str(found)
    return ""


def _status_suffix(status: int | None) -> str:
    return f"（HTTP {status}）" if status else ""


def _rid_suffix(rid: str) -> str:
    return f"（request_id: {rid}）" if rid else ""


def _render(code: str, status: int | None, rid: str, detail: dict[str, Any]) -> str:
    template = MESSAGES.get(code)
    if template is None:
        # 未知码同样不外发原文（理由见 MESSAGES 里 INTERNAL 的注释）
        return f"出错了（{code}）：请到「追踪」面板查看该轮详情。"
    fields = _Fields(detail)
    fields["status_suffix"] = _status_suffix(status)
    fields["rid_suffix"] = _rid_suffix(rid)
    return template.format_map(fields)


class AgentError(Exception):
    """跨层错误载体：``code`` 决定前端动作，``message`` 直接能给人看。

    不继承 ``HTTPException``：追踪 / 工具层也要抛它，带 FastAPI 依赖会污染底层。
    REST 出口由 ``main.py`` 的异常处理器统一转成 HTTP 响应。
    """

    def __init__(
        self,
        code: str,
        message: str | None = None,
        *,
        retryable: bool | None = None,
        stage: str = "",
        detail: dict[str, Any] | None = None,
        status_code: int | None = None,
        http_status: int | None = None,
    ) -> None:
        self.code = code
        self.detail = dict(detail or {})
        status = status_code if status_code is not None else self.detail.get("status")
        self.stage = stage
        self.retryable = RETRYABLE.get(code, False) if retryable is None else bool(retryable)
        self.http_status = http_status or HTTP_STATUS.get(code, 500)
        self.message = message or _render(code, status, _request_id_of(self.detail), self.detail)
        super().__init__(self.message)

    def __str__(self) -> str:  # noqa: D105
        return self.message

    def to_dict(self, *, with_detail: bool = False) -> dict[str, Any]:
        """SSE 帧 / 前端提示用；``detail`` 只在本地排查时给（可能含路径）。"""
        data: dict[str, Any] = {
            "code": self.code,
            "message": self.message,
            "retryable": self.retryable,
            "stage": self.stage,
        }
        if with_detail and self.detail:
            data["detail"] = dict(self.detail)
        return data

    def http_detail(self) -> str:
        """兜住旧的 ``HTTPException(detail=...)``：前端读 ``detail`` 时文案不变。"""
        return self.message


def _request_id_of(detail: dict[str, Any]) -> str:
    raw = detail.get("request_id")
    return str(raw) if raw else ""


def is_known(code: str) -> bool:
    return code in MESSAGES


def classify(exc: BaseException, *, stage: str = "") -> AgentError:
    """任意异常 → ``AgentError``。**判定顺序即优先级**，改这里要想清楚影响面：

    1. 已是 ``AgentError``（只补 stage）；
    2. 异常自带 ``tool_code``（外部 MCP 客户端打的标）；
    3. 用户取消；
    4. 401（鉴权，先于「拒绝」字样，见下方注释）；
    5. 沙箱越界 → 拒绝（两者都不重试，但下一步提示不同）；
    6. HTTP 状态码（429 / 403 / 404 / 408·504 / 5xx）；
    7. 报文特征（限流 → 超时 → 连接）；
    8. 兜底 ``INTERNAL``。
    """
    if isinstance(exc, AgentError):
        if stage and not exc.stage:
            exc.stage = stage
        return exc

    tool_code = getattr(exc, "tool_code", None)
    if isinstance(tool_code, str) and is_known(tool_code):
        return AgentError(tool_code, stage=stage, detail={"raw": str(exc) or tool_code})

    # TurnCancelled 在 agents 包里：这里按类名认，避免 errors ← agents 的循环导入。
    if type(exc).__name__ == "TurnCancelled":
        return AgentError(CANCELLED, stage=stage)

    text = f"{type(exc).__name__} {exc}"
    low = text.lower()
    status = _status_code(exc)
    rid = _request_id(exc)
    # 401 本身就说明是鉴权问题。中文网关常把「未授权」写进报文，若按下面的
    # 拒绝字样先判，会变成 TOOL_DENIED——把用户引去改权限，而该改的是 Key。
    if status == 401:
        return AgentError(
            MODEL_AUTH,
            stage=stage,
            status_code=status,
            detail={"status": status, "request_id": rid, "raw": str(exc)},
        )
    if any(marker in low for marker in _SANDBOX_MARKERS):
        return AgentError(SANDBOX_VIOLATION, stage=stage, detail={"raw": str(exc)})
    if isinstance(exc, PermissionError) or any(
        marker in low for marker in _DENIED_MARKERS
    ):
        return AgentError(TOOL_DENIED, stage=stage, detail={"raw": str(exc)})

    by_status = _code_for_status(status)
    if by_status:
        return AgentError(
            by_status,
            stage=stage,
            status_code=status,
            detail={"status": status, "request_id": rid, "raw": str(exc)},
        )

    if any(marker in low for marker in _RATE_LIMIT_MARKERS):
        return AgentError(
            MODEL_RATE_LIMIT,
            stage=stage,
            detail={"request_id": rid, "raw": str(exc)},
        )
    if isinstance(exc, TimeoutError) or any(marker in low for marker in _TIMEOUT_MARKERS):
        return AgentError(MODEL_TIMEOUT, stage=stage, detail={"raw": str(exc)})
    if isinstance(
        exc, (ConnectionError, BrokenPipeError, InterruptedError)
    ) or any(marker in low for marker in _CONNECT_MARKERS):
        return AgentError(MODEL_FAILED, stage=stage, detail={"raw": str(exc)})

    return AgentError(INTERNAL, stage=stage, detail={"raw": str(exc) or type(exc).__name__})


def _code_for_status(status: int | None) -> str | None:
    """HTTP 状态 → 码。``None`` / 其他状态码返回 ``None``，交给报文特征继续判。"""
    if status is None:
        return None
    if status == 429:
        return MODEL_RATE_LIMIT
    if status in (401, 403):
        return MODEL_AUTH
    if status == 404:
        return MODEL_NOT_FOUND
    if status in (408, 504):
        return MODEL_TIMEOUT
    if status >= 500:
        return MODEL_FAILED
    return None


def retryable(code: str) -> bool:
    return RETRYABLE.get(code, False)
