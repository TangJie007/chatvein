"""断点续跑：checkpoint 读写、可恢复列表、从现场继续。"""

from __future__ import annotations

import pytest

from agents import router
from agents.cancellation import TurnCancelled
from agents.checkpoint import (
    SqliteCheckpointer,
    discard_turn,
    latest_state,
    list_resumable,
    thread_id_for,
)
from agents.graphs import pipeline as pipeline_mod
from agents.graphs import simple as simple_mod


def _checkpoint(ckpt_id: str, *, reply: str, message: str = "继续") -> dict[str, object]:
    return {
        "id": ckpt_id,
        "channel_values": {"reply": reply, "message": message, "history": []},
        "versions_seen": {},
        "ts": "2026-11-19T00:00:00+00:00",
    }


def test_checkpointer_roundtrip_and_resumable(tmp_path: pytest.TempPathFactory) -> None:
    db = tmp_path / "session.sqlite"
    saver = SqliteCheckpointer(db)
    thread = thread_id_for("conv-1", "t1")
    config = {"configurable": {"thread_id": thread}}

    saver.put(config, _checkpoint("ck1", reply=""), {"step": 0}, {})
    item = saver.get_tuple(config)
    assert item is not None
    assert item.checkpoint["channel_values"]["reply"] == ""
    assert item.metadata["step"] == 0

    state = latest_state(db, thread)
    assert state is not None
    assert state["message"] == "继续"
    resumable = list_resumable(db)
    assert [row["thread_id"] for row in resumable] == [thread]

    saver.put(config, _checkpoint("ck2", reply="答复"), {"step": 1}, {})
    assert latest_state(db, thread)["reply"] == "答复"
    assert list_resumable(db) == []

    discard_turn(db, thread)
    assert latest_state(db, thread) is None
    assert list_resumable(db) == []


def test_checkpoint_writes_roundtrip(tmp_path: pytest.TempPathFactory) -> None:
    db = tmp_path / "session.sqlite"
    saver = SqliteCheckpointer(db)
    config = {"configurable": {"thread_id": "c:t", "checkpoint_id": "ck1"}}
    saver.put(config, _checkpoint("ck1", reply=""), {}, {})
    saver.put_writes(config, [("reply", "写入")], task_id="task-1")
    item = saver.get_tuple({"configurable": {"thread_id": "c:t"}})
    assert item is not None
    assert item.pending_writes == [("task-1", "reply", "写入")]


def test_pipeline_resumes_after_cancel(
    tmp_path: pytest.TempPathFactory, monkeypatch: pytest.MonkeyPatch
) -> None:
    db = tmp_path / "session.sqlite"
    saver = SqliteCheckpointer(db)
    thread = thread_id_for("conv-2", "t2")
    calls: list[int] = []

    monkeypatch.setattr(
        router,
        "understand",
        lambda text, role=None: {
            "rewritten": text,
            "difficulty": "simple",
            "reason": "test",
            "used_llm": False,
        },
    )

    def fake_run_simple(text: str, **kwargs: object) -> tuple[str, bool]:
        calls.append(1)
        if len(calls) == 1:
            raise TurnCancelled("用户停止")
        return "恢复后的答复", False

    monkeypatch.setattr(simple_mod, "run_simple", fake_run_simple)
    monkeypatch.setattr(pipeline_mod, "get_checkpointer", lambda: saver)
    pipeline_mod.reset_pipeline_cache()
    try:
        with pytest.raises(TurnCancelled):
            pipeline_mod.run_pipeline("继续", thread_id=thread)
        state = latest_state(db, thread)
        assert state is not None and not state.get("reply")
        assert thread in [row["thread_id"] for row in list_resumable(db)]

        out = pipeline_mod.run_pipeline("继续", thread_id=thread, resume=True)
        assert out["reply"] == "恢复后的答复"
        assert list_resumable(db) == []
    finally:
        pipeline_mod.reset_pipeline_cache()


def test_checkpoint_disabled_keeps_legacy_path(
    tmp_path: pytest.TempPathFactory, monkeypatch: pytest.MonkeyPatch
) -> None:
    db = tmp_path / "session.sqlite"
    thread = thread_id_for("conv-3", "t3")
    monkeypatch.setenv("CHATVEIN_CHECKPOINT", "0")
    monkeypatch.setattr(
        router,
        "understand",
        lambda text, role=None: {
            "rewritten": text,
            "difficulty": "simple",
            "reason": "test",
            "used_llm": False,
        },
    )
    monkeypatch.setattr(
        simple_mod, "run_simple", lambda text, **kwargs: ("离线答复", False)
    )
    pipeline_mod.reset_pipeline_cache()
    try:
        out = pipeline_mod.run_pipeline("你好", thread_id=thread)
        assert out["reply"] == "离线答复"
        assert latest_state(db, thread) is None
    finally:
        pipeline_mod.reset_pipeline_cache()
