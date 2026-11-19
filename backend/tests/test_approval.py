"""统一 HITL 审批：策略、等待/决定、超时、确定性 id 复用与落库。"""

from __future__ import annotations

import contextvars
import threading
import time
from pathlib import Path
from typing import Any

import pytest

from agents.cancellation import bind_turn
from agents.streaming import bind_stream_sink
from conversations import session_store
from mcps import approval
from mcps.approval_policy import ApprovalNeed, path_approval, shell_approval



@pytest.fixture(autouse=True)
def _reset() -> None:
    approval.reset()


def test_shell_policy_only_for_ask() -> None:
    need = shell_approval("rm report.txt", shell="bash", cwd=".")
    assert need.kind == "bash"
    assert need.title == "允许执行这条命令？"
    assert "rm report.txt" in need.detail
    assert need.risk == "medium"

    big = shell_approval("x" * 300, shell="powershell")
    assert big.kind == "powershell"
    assert big.risk == "high"


def test_path_policy_keeps_action_and_target() -> None:
    need = path_approval(Path("C:/Windows/system.ini"), "写入文件")
    assert need.kind == "path"
    lines = need.detail.splitlines()
    assert lines[0] == "写入文件"
    assert lines[1].endswith("system.ini")


def _ask_in_thread(
    need: ApprovalNeed, timeout: float = 5.0
) -> tuple[threading.Thread, list[approval.Decision]]:
    got: list[approval.Decision] = []

    def run() -> None:
        got.append(approval.request_approval(need, timeout=timeout))

    # 真实链路里 asyncio.to_thread 会复制 ContextVar；裸线程不会，手动复制。
    ctx = contextvars.copy_context()
    thread = threading.Thread(target=lambda: ctx.run(run), daemon=True)
    thread.start()
    return thread, got


def _wait_pending(count: int = 1, timeout: float = 3.0) -> list[dict[str, Any]]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        items = approval.pending()
        if len(items) >= count:
            return items
        time.sleep(0.02)
    raise AssertionError("审批请求没有出现在 pending()")


def test_request_wakes_on_allow() -> None:
    thread, got = _ask_in_thread(ApprovalNeed("bash", "允许执行这条命令？", "echo hi", "medium"))
    items = _wait_pending()
    assert items[0]["detail"] == "echo hi"
    assert approval.decide(items[0]["id"], allow=True) is True
    thread.join(timeout=3)
    assert got == ["allow"]
    assert approval.pending() == []


def test_request_deny_and_duplicate_decide() -> None:
    thread, got = _ask_in_thread(ApprovalNeed("bash", "允许执行这条命令？", "git push", "high"))
    items = _wait_pending()
    assert approval.decide(items[0]["id"], allow=False) is True
    # 已决定的请求不接受二次决定。
    assert approval.decide(items[0]["id"], allow=True) is False
    thread.join(timeout=3)
    assert got == ["deny"]


def test_timeout_means_deny() -> None:
    thread, got = _ask_in_thread(
        ApprovalNeed("bash", "允许执行这条命令？", "rm -rf build", "high"), timeout=0.2
    )
    thread.join(timeout=3)
    assert got == ["timeout"]
    assert approval.pending() == []


def test_deterministic_id_replays_decision() -> None:
    bind_turn("turn-1")
    need = ApprovalNeed("bash", "允许执行这条命令？", "echo once", "medium")
    with approval.bind_tool_call("call-1"):
        thread, got = _ask_in_thread(need, timeout=5.0)
        _wait_pending()
        items = approval.pending()
        first_id = items[0]["id"]
        assert approval.decide(first_id, allow=True)
        thread.join(timeout=3)
        assert got == ["allow"]

    # 恢复一轮：同一 turn + tool_call_id 会再问一次，直接复用决定，不再阻塞。
    with approval.bind_tool_call("call-1"):
        assert approval.request_approval(need, timeout=0.01) == "allow"
    assert first_id != "" and len(first_id) == 32


def test_pending_row_survives_and_decision_replays(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """重启语义：库里留着 pending，HTTP 侧先批准，恢复时不再弹窗。"""
    db = tmp_path / "logs" / "session.sqlite"
    monkeypatch.setattr(approval, "_session_db", lambda: db)
    bind_turn("turn-2")
    need = ApprovalNeed("bash", "允许执行这条命令？", "make deploy", "high")
    # 模拟「进程在等待审批时被杀」：库里只留下 pending 行。
    request_id = approval.request_id_for("turn-2", "call-2")
    session_store.save_approval(
        db,
        request_id=request_id,
        turn_id="turn-2",
        kind="bash",
        title=need.title,
        detail=need.detail,
        risk=need.risk,
        tool_call_id="call-2",
    )
    approval.reset()  # 内存清空，只剩会话库
    assert approval.decide(request_id, allow=True, db_path=db) is True
    assert session_store.list_pending_approvals(db) == []
    assert session_store.get_approval(db, request_id)["decision"] == "allow"

    with approval.bind_tool_call("call-2"):
        assert approval.request_approval(need, timeout=0.01) == "allow"


class _RecordingSink:
    def __init__(self) -> None:
        self.events: list[tuple[str, dict[str, Any]]] = []

    def push(self, event: str, data: dict[str, Any] | None = None) -> None:
        self.events.append((event, data or {}))

    def token(self, text: str) -> None:
        self.push("token", {"text": text})

    def tool(self, name: str, status: str, **kwargs: Any) -> None:
        self.push("tool", {"name": name, "status": status})

    def stage(self, node: str) -> None:
        self.push("trace", {"node": node})

    def approval(self, payload: dict[str, Any]) -> None:
        self.push("approval", payload)

    def approval_resolved(self, payload: dict[str, Any]) -> None:
        self.push("approval_resolved", payload)


def test_stream_events_for_approval() -> None:
    sink = _RecordingSink()
    need = ApprovalNeed("path", "允许访问会话外路径？", "读取文件\nC:/tmp/a.txt", "medium")
    with bind_stream_sink(sink):  # type: ignore[arg-type]
        thread, got = _ask_in_thread(need)
        _wait_pending()
        items = approval.pending()
        assert approval.decide(items[0]["id"], allow=True)
        thread.join(timeout=3)
        assert got == ["allow"]
    names = [event for event, _ in sink.events]
    assert names == ["approval", "approval_resolved"]
    assert sink.events[0][1]["kind"] == "path"


