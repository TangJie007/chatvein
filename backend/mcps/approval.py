"""统一 HITL 审批：工具层唯一的「等人点头」入口。

与旧 `bash_approval` 的区别：
- 请求带 `kind / title / risk`，前端一套弹窗渲染所有类型（命令 / 会话外路径 / 后续的 MCP 工具）；
- 决定按「轮次 + tool_call_id」生成确定性 id，并落会话库 `approvals` 表：
  进程重启后从 checkpoint 续跑时会再问同一个 id，历史决定直接复用，
  不会重复弹窗、更不会把同一条命令执行两遍；
- 等待期间可被「用户已取消」打断（`raise_if_cancelled`），而不是干等到超时。

开关：`CHATVEIN_UNIFIED_APPROVAL=0` 时退回旧 `bash_approval`（由调用方判断），
本模块自身不做开关判断，保持纯设施。
"""

from __future__ import annotations

import hashlib
import os
import threading
import time
import uuid
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterator, Literal

from agents.cancellation import current_turn_id, raise_if_cancelled
from agents.streaming import emit_approval, emit_approval_resolved

from .approval_policy import ApprovalNeed
from .sandbox import current_sandbox, session_db_path

Decision = Literal["allow", "deny", "timeout"]
_MAX_DECIDED = 512

_lock = threading.Lock()
_pending: dict[str, "_Pending"] = {}
#: 已决定但可能还有恢复请求要找它的 id（重启后靠会话库，进程内靠这里）。
_decided: dict[str, str] = {}
_tool_call_id: ContextVar[str] = ContextVar("chatvein_approval_tool_call", default="")


def unified_enabled() -> bool:
    raw = os.environ.get("CHATVEIN_UNIFIED_APPROVAL")
    if raw is None:
        return True
    return raw.strip().lower() not in {"0", "false", "no", "off", ""}


def approval_timeout() -> float:
    """``CHATVEIN_APPROVAL_TIMEOUT`` > 旧 ``CHATVEIN_BASH_APPROVAL_TIMEOUT`` > 120s。"""
    for name in ("CHATVEIN_APPROVAL_TIMEOUT", "CHATVEIN_BASH_APPROVAL_TIMEOUT"):
        raw = (os.environ.get(name) or "").strip()
        if raw:
            try:
                return max(5.0, float(raw))
            except ValueError:
                continue
    return 120.0


@dataclass
class _Pending:
    id: str
    turn_id: str
    kind: str
    title: str
    detail: str
    risk: str
    tool_call_id: str
    created_at: float
    event: threading.Event = field(default_factory=threading.Event)
    decision: str | None = None
    announced: bool = False

    def public(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "turn_id": self.turn_id,
            "kind": self.kind,
            "title": self.title,
            "detail": self.detail,
            "risk": self.risk,
            "tool_call_id": self.tool_call_id,
            "created_at": self.created_at,
            # 兼容旧弹窗字段：命令类动作把 detail 当 command，路径类给 cwd 占位。
            "command": self.detail,
            "cwd": "",
        }


@contextmanager
def bind_tool_call(call_id: str | None) -> Iterator[None]:
    """ReAct 中间件在工具执行前绑定本轮 tool_call_id（用于确定性审批 id）。"""
    token = _tool_call_id.set((call_id or "").strip())
    try:
        yield
    finally:
        _tool_call_id.reset(token)


def request_id_for(turn_id: str, tool_call_id: str) -> str:
    """确定性 id：同轮同 tool_call 永远映射到同一条审批（恢复时复用决定）。"""
    if turn_id and tool_call_id:
        digest = hashlib.blake2s(
            f"{turn_id}:{tool_call_id}".encode("utf-8"), digest_size=16
        ).hexdigest()
        return digest
    return uuid.uuid4().hex


_request_id = request_id_for


def _session_db() -> Path | None:
    """当前线程在会话沙箱里才拿得到会话库；HTTP 线程返回 ``None``（不落库）。"""
    try:
        return session_db_path(current_sandbox())
    except Exception:  # noqa: BLE001 - 审批不能因为拿不到库而失败
        return None


def _remember_decision(db: Path | None, request_id: str, decision: str) -> None:
    with _lock:
        _decided[request_id] = decision
        if len(_decided) > _MAX_DECIDED:
            for key in list(_decided)[: len(_decided) // 2]:
                _decided.pop(key, None)
    if db is None:
        return
    try:
        from conversations import session_store  # pyright: ignore[reportImplicitRelativeImport]

        session_store.decide_approval(db, request_id, decision)
    except Exception:  # noqa: BLE001 - 审计失败不影响审批结果
        return


def _lookup_decision(db: Path | None, request_id: str) -> str | None:
    with _lock:
        hit = _decided.get(request_id)
    if hit:
        return hit
    if db is None:
        return None
    try:
        from conversations import session_store  # pyright: ignore[reportImplicitRelativeImport]

        row = session_store.get_approval(db, request_id)
    except Exception:  # noqa: BLE001
        return None
    if row and row.get("status") == "decided":
        return str(row.get("decision") or "")
    return None


def request_approval(
    need: ApprovalNeed, *, timeout: float | None = None
) -> Decision:
    """阻塞等待人工决定。返回 ``allow`` / ``deny`` / ``timeout``（超时按拒绝处理）。"""
    turn_id = current_turn_id() or ""
    call_id = _tool_call_id.get()
    request_id = _request_id(turn_id, call_id)
    db = _session_db()

    replay = _lookup_decision(db, request_id)
    if replay in {"allow", "deny"}:
        return replay  # type: ignore[return-value]

    announce = False
    with _lock:
        item = _pending.get(request_id)
        if item is None:
            item = _Pending(
                id=request_id,
                turn_id=turn_id,
                kind=need.kind,
                title=need.title,
                detail=need.detail,
                risk=need.risk,
                tool_call_id=call_id,
                created_at=time.time(),
            )
            _pending[request_id] = item
        elif item.decision is not None:
            # 同一 id 已有决定（恢复重放）：直接复用，不再等待。
            return item.decision  # type: ignore[return-value]
        if not item.announced:
            item.announced = True
            announce = True

    if announce:
        emit_approval(item.public())
        if db is not None:
            try:
                from conversations import session_store  # pyright: ignore[reportImplicitRelativeImport]

                session_store.save_approval(
                    db,
                    request_id=item.id,
                    turn_id=item.turn_id,
                    kind=item.kind,
                    title=item.title,
                    detail=item.detail,
                    risk=item.risk,
                    tool_call_id=item.tool_call_id,
                )
            except Exception:  # noqa: BLE001
                pass

    wait_s = approval_timeout() if timeout is None else max(0.0, timeout)
    decision = _wait(item, wait_s)
    if decision == "timeout":
        # 超时只作废本次等待，不写成「已决定」：重启 / 恢复时还能重新问一次。
        if db is not None:
            try:
                from conversations import session_store  # pyright: ignore[reportImplicitRelativeImport]

                session_store.expire_approval(db, request_id)
            except Exception:  # noqa: BLE001
                pass
    else:
        _remember_decision(db, request_id, decision)
    with _lock:
        _pending.pop(request_id, None)
    emit_approval_resolved({"request_id": request_id, "decision": decision})
    return decision


def _wait(item: _Pending, timeout: float) -> Decision:
    deadline = time.monotonic() + timeout
    while True:
        if item.event.wait(0.1):
            return item.decision or "deny"  # type: ignore[return-value]
        raise_if_cancelled()
        if time.monotonic() >= deadline:
            return "timeout"


def decide(request_id: str, *, allow: bool, db_path: Path | None = None) -> bool:
    """前端提交决定。没有等待中的请求时也接受（用于重启后先批后恢复）。"""
    decision = "allow" if allow else "deny"
    with _lock:
        item = _pending.get(request_id)
    if item is not None:
        if item.decision is not None:
            return False
        item.decision = decision
        item.event.set()
        return True
    # 无 waiter：若会话库里有这条待批记录（重启现场），记下决定供恢复时复用。
    db = db_path
    if db is None:
        return False
    try:
        from conversations import session_store  # pyright: ignore[reportImplicitRelativeImport]

        row = session_store.get_approval(db, request_id)
    except Exception:  # noqa: BLE001
        return False
    if not row or row.get("status") != "pending":
        return False
    _remember_decision(db, request_id, decision)
    return True


def pending() -> list[dict[str, Any]]:
    """当前进程内等待中的审批（全局弹窗轮询用）。"""
    with _lock:
        items = sorted(_pending.values(), key=lambda it: it.created_at)
    return [item.public() for item in items if item.decision is None]


def reset() -> None:
    """测试用：清空内存状态。"""
    with _lock:
        _pending.clear()
        _decided.clear()


__all__ = [
    "Decision",
    "approval_timeout",
    "bind_tool_call",
    "decide",
    "pending",
    "request_approval",
    "request_id_for",
    "reset",
    "unified_enabled",
]
