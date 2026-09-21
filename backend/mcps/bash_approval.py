"""需要用户点允许才会执行的 Bash 命令。确认在发起命令的线程上完成。"""

from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass

_lock = threading.Lock()


@dataclass
class PendingBash:
    id: str
    command: str
    cwd: str
    created_at: float
    event: threading.Event
    decision: str | None = None


_pending: dict[str, PendingBash] = {}


def create_pending(command: str, cwd: str) -> str:
    item = PendingBash(
        id=uuid.uuid4().hex,
        command=command,
        cwd=cwd,
        created_at=time.time(),
        event=threading.Event(),
    )
    with _lock:
        _pending[item.id] = item
    return item.id


def list_pending() -> list[dict[str, str | float]]:
    with _lock:
        items = sorted(_pending.values(), key=lambda item: item.created_at)
    return [
        {
            "id": item.id,
            "command": item.command,
            "cwd": item.cwd,
            "created_at": item.created_at,
        }
        for item in items
        if item.decision is None
    ]


def decide(approval_id: str, *, allow: bool) -> bool:
    with _lock:
        item = _pending.get(approval_id)
        if item is None or item.decision is not None:
            return False
        item.decision = "allow" if allow else "deny"
        item.event.set()
        return True


def wait_decision(approval_id: str, timeout: float) -> str:
    with _lock:
        item = _pending.get(approval_id)
    if item is None:
        return "deny"
    item.event.wait(timeout)
    with _lock:
        decision = item.decision or "timeout"
        _pending.pop(approval_id, None)
    return decision
