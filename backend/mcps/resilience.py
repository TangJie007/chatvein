"""工具调用的韧性层：异常分类、退避重试、本轮熔断、幂等去重。

只包裹「执行一次工具」这一层，不改任何工具实现；LangChain 侧由
``graphs/common.py::resilient_tool_middleware`` 接进 ReAct，离线侧由
``registry.py::invoke_tools`` 直接调 :func:`execute_tool_call`。

三个约束（都有单测固定）：
- 取消优先：等待退避期间也要能被「用户已取消」打断，抛 ``TurnCancelled`` 而不是吞成工具错误；
- 副作用不重试：shell / 代码执行 / pip 等交给 ``NO_RETRY_TOOLS``；
- 幂等：同一次 ``tool_call_id`` 的结果缓存，重试或模型重复调用不会写第二遍。
"""

from __future__ import annotations

import json
import os
import random
import time
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any, Callable, Iterator

from agents.cancellation import TurnCancelled, raise_if_cancelled

from .tool_result import (
    TOOL_CIRCUIT_OPEN,
    TOOL_DENIED,
    TOOL_FAILED,
    TOOL_TRANSIENT_EXHAUSTED,
    ToolResult,
)

#: 有副作用的写操作：按 ``tool_call_id`` 缓存结果，重放直接命中。
IDEMPOTENT_TOOLS: frozenset[str] = frozenset(
    {
        "write_file",
        "edit_file",
        "delete_path",
        "move_file",
        "create_directory",
        "sandbox_write_file",
        "generate_word_document",
        "edit_word_document",
        "generate_excel_workbook",
        "edit_excel_workbook",
        "generate_powerpoint_document",
        "edit_powerpoint_document",
        "pdf_generate",
        "pdf_merge",
        "pdf_split",
        "pdf_split_files",
        "pdf_encrypt",
        "pdf_decrypt",
        "kb_add_note",
    }
)

#: 执行型副作用：一次调用可能留下不可逆痕迹，即使报错也不自动重试。
NO_RETRY_TOOLS: frozenset[str] = frozenset(
    {
        "bash_run",
        "powershell_run",
        "sandbox_run_python",
        "sandbox_pip_install",
        "sandbox_create_venv",
        "kb_index_workspace",
    }
)

_TRANSIENT_ERRNOS = {
    4,  # EINTR
    32,  # EPIPE
    54,  # ECONNRESET (macOS)
    60,  # ETIMEDOUT (macOS)
    100,  # ENETDOWN
    101,  # ENETUNREACH
    104,  # ECONNRESET (Linux)
    110,  # ETIMEDOUT (Linux)
    111,  # ECONNREFUSED
}

_CACHE_LIMIT = 256


def _env_flag(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() not in {"0", "false", "no", "off", ""}


def _env_float(name: str, default: float) -> float:
    try:
        return float(str(os.environ.get(name) or "").strip())
    except ValueError:
        return default


def _env_int(name: str, default: int) -> int:
    try:
        return int(float(str(os.environ.get(name) or "").strip()))
    except ValueError:
        return default


def tool_retry_enabled() -> bool:
    """总开关：``CHATVEIN_TOOL_RETRY=0`` 时重试与熔断整体关闭（透传旧行为）。"""
    return _env_flag("CHATVEIN_TOOL_RETRY", True)


def max_attempts() -> int:
    return max(1, min(5, _env_int("CHATVEIN_TOOL_MAX_ATTEMPTS", 3)))


def circuit_threshold() -> int:
    return max(1, min(10, _env_int("CHATVEIN_TOOL_CB_THRESHOLD", 3)))


def _retry_base_s() -> float:
    return max(0.0, min(5.0, _env_float("CHATVEIN_TOOL_RETRY_BASE", 0.5)))


def classify_exception(exc: BaseException) -> str:
    """把异常归到 ``transient|deterministic|denied|cancelled``。"""
    if isinstance(exc, TurnCancelled):
        return "cancelled"
    message = str(exc).lower()
    if isinstance(exc, PermissionError):
        return "denied"
    # 工具层拒绝（会话外路径 / 命令策略）多半是带中文原因的 ValueError。
    if any(word in message for word in ("拒绝", "不允许", "未授权", "denied", "not allowed")):
        return "denied"
    if isinstance(
        exc,
        (TimeoutError, ConnectionError, BrokenPipeError, InterruptedError),
    ):
        return "transient"
    status = getattr(exc, "status_code", None)
    if status is None:
        response = getattr(exc, "response", None)
        status = getattr(response, "status_code", None)
    if isinstance(status, int) and (status == 429 or status >= 500):
        return "transient"
    name = type(exc).__name__.lower()
    transient_words = ("timeout", "connection", "connect", "transport", "network", "httpx")
    if any(word in name for word in transient_words):
        return "transient"
    if isinstance(exc, OSError) and exc.errno in _TRANSIENT_ERRNOS:
        return "transient"
    return "deterministic"


@dataclass
class TurnState:
    """一轮对话内的工具状态：熔断计数 + 幂等缓存。"""

    fails: dict[str, int] = field(default_factory=dict)
    opened: set[str] = field(default_factory=set)
    cache: dict[str, ToolResult] = field(default_factory=dict)
    recent_failures: list[str] = field(default_factory=list)
    attempts: int = 0

    def circuit_open(self, name: str) -> bool:
        return name in self.opened

    def note_outcome(self, name: str, result: ToolResult) -> None:
        self.attempts += 1
        if result.ok:
            self.fails.pop(name, None)
            return
        fails = self.fails.get(name, 0) + 1
        self.fails[name] = fails
        if name not in self.recent_failures:
            self.recent_failures.append(name)
        if fails >= circuit_threshold():
            self.opened.add(name)


_state: ContextVar[TurnState | None] = ContextVar("chatvein_tool_state", default=None)


@contextmanager
def tool_scope(turn_id: str | None = None) -> Iterator[TurnState]:
    """给一轮对话建立独立状态（熔断与幂等不外溢到下一轮）。"""
    state = TurnState()
    token = _state.set(state)
    try:
        yield state
    finally:
        _state.reset(token)


def current_state() -> TurnState:
    state = _state.get()
    return state if state is not None else TurnState()


def recent_failed_tools() -> list[str]:
    state = _state.get()
    return list(state.recent_failures) if state else []


def idempotency_key(tool_name: str, call_id: str) -> str:
    return f"{tool_name}:{call_id}" if call_id else ""


def _content_of(raw: Any) -> tuple[str, bool]:
    """把工具返回值规约成（给模型看的文本, 是否成功）。"""
    status = getattr(raw, "status", None)
    content = getattr(raw, "content", None)
    if content is not None and not isinstance(content, (str, list, dict)):
        content = str(content)
    if content is None:
        if raw is None:
            return "", True
        if isinstance(raw, str):
            return raw, True
        try:
            return json.dumps(raw, ensure_ascii=False, default=str), True
        except TypeError:
            return str(raw), True
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                parts.append(str(block.get("text") or ""))
            else:
                parts.append(str(block))
        content = "".join(parts)
    elif isinstance(content, dict):
        try:
            content = json.dumps(content, ensure_ascii=False, default=str)
        except TypeError:
            content = str(content)
    return str(content), status != "error"


def _failure_text(tool_name: str, exc: BaseException, kind: str, attempts: int) -> str:
    reason = str(exc).strip() or type(exc).__name__
    if kind == "denied":
        return (
            f"[{tool_name}] 失败: 权限被拒绝（{reason}）。"
            "请改用会话内可访问的路径，或请用户在界面上手动处理。"
        )
    if kind == "transient":
        return (
            f"[{tool_name}] 失败: 网络或服务暂时不可用（{reason}，已尝试 {attempts} 次）。"
            "可以稍后重试，或换用其他工具。"
        )
    return f"[{tool_name}] 失败: {reason}. 请检查参数后重试，或改用其他工具。"


def _sleep_with_cancel(seconds: float) -> None:
    """分片等待：每 50ms 检查一次取消，避免「点了停止还在干等退避」。"""
    deadline = time.monotonic() + max(0.0, seconds)
    while True:
        raise_if_cancelled()
        left = deadline - time.monotonic()
        if left <= 0:
            return
        time.sleep(min(0.05, left))


def _note_retry(tool_name: str, attempt: int, kind: str, exc: BaseException) -> None:
    try:
        from trace.recording import note

        note(
            "tool_retry",
            name=tool_name,
            status="warn",
            tool=tool_name,
            attempt=attempt,
            error_kind=kind,
            reason=str(exc)[:200],
        )
    except Exception:  # noqa: BLE001 - 追踪不可用时不能影响主流程
        return


def execute_tool_call(
    *,
    tool_name: str,
    call_id: str,
    invoke: Callable[[], Any],
    state: TurnState | None = None,
) -> ToolResult:
    """执行一次工具，附带幂等命中、熔断与 transient 重试。"""
    st = state if state is not None else current_state()
    enabled = tool_retry_enabled()
    key = idempotency_key(tool_name, call_id)

    if enabled and key and tool_name in IDEMPOTENT_TOOLS:
        hit = st.cache.get(key)
        if hit is not None:
            return hit

    if enabled and st.circuit_open(tool_name):
        return ToolResult(
            ok=False,
            content=(
                f"[{tool_name}] 连续失败已熔断：本轮不再执行该工具。"
                "请改用其他工具，或直接基于已有结果作答。"
            ),
            code=TOOL_CIRCUIT_OPEN,
            error_kind="deterministic",
            tool=tool_name,
        )

    attempts_allowed = 1
    if enabled and tool_name not in NO_RETRY_TOOLS:
        attempts_allowed = max_attempts()

    started = time.monotonic()
    attempts = 0
    result: ToolResult | None = None
    while attempts < attempts_allowed:
        attempts += 1
        try:
            raw = invoke()
        except TurnCancelled:
            raise
        except Exception as exc:  # noqa: BLE001 - 统一归一到 ToolResult
            kind = classify_exception(exc)
            retry_left = attempts < attempts_allowed
            if kind == "transient" and retry_left:
                _note_retry(tool_name, attempts, kind, exc)
                base = _retry_base_s()
                delay = base * (2 ** (attempts - 1))
                _sleep_with_cancel(delay * random.uniform(0.8, 1.2))
                continue
            code = TOOL_DENIED if kind == "denied" else (
                TOOL_TRANSIENT_EXHAUSTED if kind == "transient" else TOOL_FAILED
            )
            result = ToolResult(
                ok=False,
                content=_failure_text(tool_name, exc, kind, attempts),
                code=code,
                retryable=kind == "transient",
                error_kind=kind,
                tool=tool_name,
                attempts=attempts,
            )
            break
        else:
            content, ok = _content_of(raw)
            result = ToolResult(
                ok=ok,
                content=content,
                code="TOOL_OK" if ok else TOOL_FAILED,
                retryable=False,
                error_kind=None if ok else "deterministic",
                tool=tool_name,
                attempts=attempts,
            )
            break

    if result is None:  # pragma: no cover - 循环必然有出口
        result = ToolResult(ok=False, content=f"[{tool_name}] 失败: 未知错误", tool=tool_name)

    result.duration_ms = int((time.monotonic() - started) * 1000)
    st.note_outcome(tool_name, result)
    if enabled and key and tool_name in IDEMPOTENT_TOOLS and result.ok:
        if len(st.cache) >= _CACHE_LIMIT:
            st.cache.pop(next(iter(st.cache)), None)
        st.cache[key] = result
    return result


__all__ = [
    "IDEMPOTENT_TOOLS",
    "NO_RETRY_TOOLS",
    "TurnState",
    "circuit_threshold",
    "classify_exception",
    "current_state",
    "execute_tool_call",
    "idempotency_key",
    "max_attempts",
    "recent_failed_tools",
    "tool_retry_enabled",
    "tool_scope",
]
