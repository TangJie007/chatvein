"""团队并行编排（批次 2 §2.4）：fan-out、失败隔离、取消、聚合降级、任务板。"""

from __future__ import annotations

import time
from pathlib import Path

import pytest

import agents.orchestration as orch
from agents.cancellation import TurnCancelled, bind_turn, cancel_turn
from agents.delegation import MemberOutcome, set_team_context
from conversations import session_store
from conversations.entity import CreateConversationDto
from conversations.service import ConversationsService
from mcps.sandbox import current_sandbox, session_db_path, use_conversation_sandbox


@pytest.fixture(autouse=True)
def _reset_turn_binding() -> None:
    yield
    bind_turn(None)  # 避免 turn_id 串到后续用例（审批 id / 任务板都用它）


@pytest.fixture()
def sandbox() -> Path:
    name = ConversationsService().create_conversation(
        CreateConversationDto(title="parallel")
    )["workspace_dir"]
    with use_conversation_sandbox(name) as root:
        yield root


def _roster(*role_ids: str) -> None:
    set_team_context(
        {
            "workspace_dir": "",
            "roster": {rid: {"name": rid.upper(), "description": ""} for rid in role_ids},
            "role": None,
        }
    )


def test_parallel_switch_and_clamp(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CHATVEIN_PARALLEL_DELEGATE", raising=False)
    monkeypatch.delenv("CHATVEIN_DELEGATE_MAX_PARALLEL", raising=False)
    assert orch.max_parallel() == 4
    assert orch.parallel_enabled()

    monkeypatch.setenv("CHATVEIN_DELEGATE_MAX_PARALLEL", "99")
    assert orch.max_parallel() == 8

    monkeypatch.setenv("CHATVEIN_DELEGATE_MAX_PARALLEL", "1")
    assert not orch.parallel_enabled()

    monkeypatch.setenv("CHATVEIN_DELEGATE_MAX_PARALLEL", "4")
    monkeypatch.setenv("CHATVEIN_PARALLEL_DELEGATE", "0")
    assert not orch.parallel_enabled()


def test_normalize_accepts_dicts_and_skips_empty() -> None:
    tasks = orch._normalize_tasks(
        [
            {"role_id": "r1", "task": "查资料"},
            {"role_id": "r2", "task": ""},
            {"role_id": "", "task": "写文案"},
            orch.DelegateTask(role_id="r3", task="做表", instruction="csv"),
        ]
    )
    assert [t.role_id for t in tasks] == ["r1", "r3"]


def test_fan_out_is_parallel(monkeypatch: pytest.MonkeyPatch) -> None:
    """3 个各睡 0.3s：并行应明显快于串行累加（给足余量避免 CI 抖动）。"""
    _roster("r1", "r2", "r3")
    monkeypatch.setattr(orch, "max_parallel", lambda: 3)

    def fake(role_id: str, task: str, instruction: str | None = None) -> MemberOutcome:
        time.sleep(0.3)
        return MemberOutcome(role_id, role_id.upper(), True, f"{role_id}-done")

    monkeypatch.setattr(orch, "run_member_task", fake)
    specs = [
        orch.DelegateTask(role_id=rid, task="t") for rid in ("r1", "r2", "r3")
    ]
    started = time.perf_counter()
    orch.parallel_delegate.func(specs)
    elapsed = time.perf_counter() - started
    assert elapsed < 0.75, f"疑似串行：{elapsed:.2f}s"


def test_one_member_failure_does_not_fail_batch(monkeypatch: pytest.MonkeyPatch) -> None:
    _roster("r1", "r2")
    monkeypatch.setattr(orch, "max_parallel", lambda: 2)

    def fake(role_id: str, task: str, instruction: str | None = None) -> MemberOutcome:
        if role_id == "r2":
            raise RuntimeError("模型超时")
        return MemberOutcome(role_id, role_id.upper(), True, "r1 的结果")

    monkeypatch.setattr(orch, "run_member_task", fake)
    monkeypatch.setattr(orch, "get_chat_model", lambda **_: None)
    text = orch.parallel_delegate.func(
        [orch.DelegateTask(role_id="r1", task="a"), orch.DelegateTask(role_id="r2", task="b")]
    )
    assert "r1 的结果" in text
    assert "r2" in text
    assert "未完成" in text or "RuntimeError" in text


def test_cancel_interrupts_pending(monkeypatch: pytest.MonkeyPatch) -> None:
    _roster("r1")
    bind_turn("turn-cancel")
    cancel_turn("turn-cancel")
    monkeypatch.setattr(orch, "max_parallel", lambda: 1)

    def fake(role_id: str, task: str, instruction: str | None = None) -> MemberOutcome:
        time.sleep(0.5)
        return MemberOutcome(role_id, role_id, True, "late")

    monkeypatch.setattr(orch, "run_member_task", fake)
    with pytest.raises(TurnCancelled):
        orch.parallel_delegate.func([orch.DelegateTask(role_id="r1", task="a")])


def test_aggregate_falls_back_without_model(monkeypatch: pytest.MonkeyPatch) -> None:
    _roster("r1", "r2")
    monkeypatch.setattr(orch, "max_parallel", lambda: 2)
    monkeypatch.setattr(orch, "get_chat_model", lambda **_: None)

    outcomes = [
        MemberOutcome("r1", "R1", True, "结论 A"),
        MemberOutcome("r2", "R2", True, "结论 B"),
    ]
    specs = [orch.DelegateTask(role_id="r1", task="a"), orch.DelegateTask(role_id="r2", task="b")]
    text = orch._aggregate(None, specs, outcomes)
    assert "结论 A" in text and "结论 B" in text


def test_single_task_skips_aggregate(monkeypatch: pytest.MonkeyPatch) -> None:
    called: list[int] = []
    monkeypatch.setattr(
        orch, "get_chat_model", lambda **_: called.append(1) or None
    )
    outcome = MemberOutcome("r1", "R1", True, "唯一结果")
    spec = orch.DelegateTask(role_id="r1", task="a")
    assert orch._aggregate({"model_id": "m"}, [spec], [outcome]) == "### R1\n唯一结果"
    assert called == []


def test_board_rows_track_status(monkeypatch: pytest.MonkeyPatch, sandbox: Path) -> None:
    _roster("r1", "r2")
    bind_turn("turn-board")
    monkeypatch.setattr(orch, "max_parallel", lambda: 2)
    monkeypatch.setattr(orch, "get_chat_model", lambda **_: None)

    def fake(role_id: str, task: str, instruction: str | None = None) -> MemberOutcome:
        if role_id == "r2":
            return MemberOutcome(role_id, "R2", False, "没模型", "NO_MODEL")
        return MemberOutcome(role_id, "R1", True, "ok")

    monkeypatch.setattr(orch, "run_member_task", fake)
    orch.parallel_delegate.func(
        [orch.DelegateTask(role_id="r1", task="a"), orch.DelegateTask(role_id="r2", task="b")]
    )

    rows = session_store.list_agent_tasks(
        session_db_path(current_sandbox()), turn_id="turn-board"
    )
    assert len(rows) == 2
    statuses = {row["role_id"]: row["status"] for row in rows}
    assert statuses == {"r1": "done", "r2": "failed"}
    assert any(row["error_code"] == "NO_MODEL" for row in rows)
