"""LangGraph 断点：把每一步的状态写进会话库 ``logs/session.sqlite``。

为什么不做成「进程级全局库」：会话库本来就按会话工作区隔离，磁盘归属和
清理（删会话即删目录）都与会话同生命周期，不需要额外的回收逻辑。

三点与官方 ``SqliteSaver`` 的差异（都是刻意的）：
- 库路径按调用时解析：``use_conversation_sandbox`` 的 ContextVar 决定当前会话，
  因此一张编译好的图可以被所有会话共用，不用每轮重编译；
- 额外存 ``reply`` 冗余列：判断「这一轮是否已经产出答复」只需一次查询，
  不用反序列化整份 checkpoint；
- 只支持单 ``checkpoint_ns``（本项目没有子图命名空间）。
"""

from __future__ import annotations

import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from . import config
from langgraph.checkpoint.base import (
    BaseCheckpointSaver,
    Checkpoint,
    CheckpointMetadata,
    CheckpointTuple,
)

_DDL = """
CREATE TABLE IF NOT EXISTS agent_checkpoints (
    thread_id TEXT NOT NULL,
    checkpoint_ns TEXT NOT NULL DEFAULT '',
    checkpoint_id TEXT NOT NULL,
    parent_checkpoint_id TEXT,
    checkpoint_type TEXT,
    checkpoint BLOB,
    metadata_type TEXT,
    metadata BLOB,
    reply TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
);
CREATE INDEX IF NOT EXISTS idx_agent_checkpoints_recent
ON agent_checkpoints(thread_id, checkpoint_ns, created_at DESC);
CREATE TABLE IF NOT EXISTS agent_checkpoint_writes (
    thread_id TEXT NOT NULL,
    checkpoint_ns TEXT NOT NULL DEFAULT '',
    checkpoint_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    idx INTEGER NOT NULL,
    channel TEXT NOT NULL,
    value_type TEXT,
    value BLOB,
    PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
);
"""

_ensured: set[str] = set()
_ensure_lock = threading.Lock()


def checkpoint_enabled() -> bool:
    """``CHATVEIN_CHECKPOINT=0`` 关掉中断续跑（判定口径见 ``agents/config.py``）。"""
    return config.flag("CHATVEIN_CHECKPOINT", True)


def thread_id_for(conversation_id: str, turn_id: str) -> str:
    """一条线程 = 一次作答；会话库已按会话隔离，前缀只为可读性。"""
    return f"{conversation_id or '-'}:{turn_id or '-'}"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


class SqliteCheckpointer(BaseCheckpointSaver):
    """同步版 checkpointer（本项目图全部 ``invoke``，不走 async）。"""

    def __init__(self, db_path: Path | str | None = None) -> None:
        super().__init__()
        self._explicit = Path(db_path) if db_path else None

    # ---- 基础 ---------------------------------------------------------
    def _db(self) -> Path:
        if self._explicit is not None:
            return self._explicit
        from mcps.sandbox import current_sandbox, session_db_path

        return session_db_path(current_sandbox())

    def _connect(self) -> sqlite3.Connection:
        path = self._db()
        key = str(path)
        with _ensure_lock:
            first = key not in _ensured
            if first:
                _ensured.add(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(path, timeout=15)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        if first:
            conn.executescript(_DDL)
            conn.commit()
        return conn

    @staticmethod
    def _cfg(config: dict[str, Any], *, checkpoint_id: str | None = None) -> dict[str, Any]:
        configurable = dict((config or {}).get("configurable") or {})
        out: dict[str, Any] = {"configurable": configurable}
        if checkpoint_id is not None:
            out["configurable"] = {**configurable, "checkpoint_id": checkpoint_id}
        return out

    # ---- 读 -----------------------------------------------------------
    def get_tuple(self, config: dict[str, Any]) -> CheckpointTuple | None:
        thread_id = str((config.get("configurable") or {}).get("thread_id") or "")
        if not thread_id:
            return None
        ns = str((config.get("configurable") or {}).get("checkpoint_ns") or "")
        ckpt_id = (config.get("configurable") or {}).get("checkpoint_id")
        query = (
            "SELECT * FROM agent_checkpoints WHERE thread_id = ? AND checkpoint_ns = ?"
        )
        params: list[Any] = [thread_id, ns]
        if ckpt_id:
            query += " AND checkpoint_id = ?"
            params.append(str(ckpt_id))
        query += " ORDER BY created_at DESC, rowid DESC LIMIT 1"
        with self._connect() as conn:
            row = conn.execute(query, params).fetchone()
            if row is None:
                return None
            writes = conn.execute(
                "SELECT * FROM agent_checkpoint_writes WHERE thread_id = ? "
                "AND checkpoint_ns = ? AND checkpoint_id = ? "
                "ORDER BY task_id, idx",
                (thread_id, ns, row["checkpoint_id"]),
            ).fetchall()

        checkpoint = self.serde.loads_typed((row["checkpoint_type"], row["checkpoint"]))
        metadata = (
            self.serde.loads_typed((row["metadata_type"], row["metadata"]))
            if row["metadata"]
            else {}
        )
        # LangGraph 要的是 (task_id, channel, value)，少一个字段会在恢复时炸。
        pending: list[tuple[str, str, Any]] = [
            (
                str(item["task_id"]),
                str(item["channel"]),
                self.serde.loads_typed((item["value_type"], item["value"])),
            )
            for item in writes
        ]
        parent_config = (
            self._cfg(config, checkpoint_id=str(row["parent_checkpoint_id"]))
            if row["parent_checkpoint_id"]
            else None
        )
        return CheckpointTuple(
            config=self._cfg(config, checkpoint_id=str(row["checkpoint_id"])),
            checkpoint=checkpoint,
            metadata=metadata,
            parent_config=parent_config,
            pending_writes=pending,
        )

    def list(
        self,
        config: dict[str, Any] | None,
        *,
        filter: dict[str, Any] | None = None,
        before: dict[str, Any] | None = None,
        limit: int | None = None,
    ) -> Iterator[CheckpointTuple]:
        thread_id = str(((config or {}).get("configurable") or {}).get("thread_id") or "")
        if not thread_id:
            return
        ns = str(((config or {}).get("configurable") or {}).get("checkpoint_ns") or "")
        query = (
            "SELECT checkpoint_id FROM agent_checkpoints "
            "WHERE thread_id = ? AND checkpoint_ns = ?"
        )
        params: list[Any] = [thread_id, ns]
        before_id = ((before or {}).get("configurable") or {}).get("checkpoint_id")
        if before_id:
            # created_at 可能同毫秒，先用 rowid 定位更稳；简化：按时间过滤即可。
            query += " AND checkpoint_id != ?"
            params.append(str(before_id))
        query += " ORDER BY created_at DESC, rowid DESC"
        if limit:
            query += " LIMIT ?"
            params.append(int(limit))
        with self._connect() as conn:
            ids = [row["checkpoint_id"] for row in conn.execute(query, params).fetchall()]
        for ckpt_id in ids:
            item = self.get_tuple(self._cfg(config or {}, checkpoint_id=str(ckpt_id)))
            if item is not None:
                yield item

    # ---- 写 -----------------------------------------------------------
    def put(
        self,
        config: dict[str, Any],
        checkpoint: Checkpoint,
        metadata: CheckpointMetadata,
        new_versions: dict[str, Any],
    ) -> dict[str, Any]:
        thread_id = str((config.get("configurable") or {}).get("thread_id") or "")
        ns = str((config.get("configurable") or {}).get("checkpoint_ns") or "")
        ckpt_id = str(checkpoint.get("id") or "")
        checkpoint_type, checkpoint_bytes = self.serde.dumps_typed(checkpoint)
        metadata_type, metadata_bytes = self.serde.dumps_typed(metadata or {})
        values = checkpoint.get("channel_values") or {}
        reply = str(values.get("reply") or "") if isinstance(values, dict) else ""
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO agent_checkpoints("
                "thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id,"
                " checkpoint_type, checkpoint, metadata_type, metadata, reply, created_at"
                ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(thread_id, checkpoint_ns, checkpoint_id) DO UPDATE SET "
                "checkpoint_type = excluded.checkpoint_type, "
                "checkpoint = excluded.checkpoint, "
                "metadata_type = excluded.metadata_type, "
                "metadata = excluded.metadata, "
                "reply = excluded.reply",
                (
                    thread_id,
                    ns,
                    ckpt_id,
                    str(checkpoint.get("parent_checkpoint_id") or "") or None,
                    checkpoint_type,
                    checkpoint_bytes,
                    metadata_type,
                    metadata_bytes,
                    reply,
                    _now(),
                ),
            )
            conn.commit()
        return self._cfg(config, checkpoint_id=ckpt_id)

    def put_writes(
        self,
        config: dict[str, Any],
        writes: list[tuple[str, Any]],
        task_id: str,
        task_path: str = "",
    ) -> None:
        thread_id = str((config.get("configurable") or {}).get("thread_id") or "")
        ns = str((config.get("configurable") or {}).get("checkpoint_ns") or "")
        ckpt_id = str((config.get("configurable") or {}).get("checkpoint_id") or "")
        with self._connect() as conn:
            for idx, (channel, value) in enumerate(writes):
                value_type, value_bytes = self.serde.dumps_typed(value)
                conn.execute(
                    "INSERT INTO agent_checkpoint_writes("
                    "thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel,"
                    " value_type, value) VALUES (?, ?, ?, ?, ?, ?, ?, ?) "
                    "ON CONFLICT(thread_id, checkpoint_ns, checkpoint_id, task_id, idx) "
                    "DO UPDATE SET channel = excluded.channel, "
                    "value_type = excluded.value_type, value = excluded.value",
                    (
                        thread_id,
                        ns,
                        ckpt_id,
                        task_id,
                        idx,
                        channel,
                        value_type,
                        value_bytes,
                    ),
                )
            conn.commit()

    def delete_thread(self, thread_id: str) -> None:
        with self._connect() as conn:
            conn.execute("DELETE FROM agent_checkpoints WHERE thread_id = ?", (thread_id,))
            conn.execute(
                "DELETE FROM agent_checkpoint_writes WHERE thread_id = ?", (thread_id,)
            )
            conn.commit()


# ---- 进程内单例（图编译一次，跨会话复用） ---------------------------------
_saver: SqliteCheckpointer | None = None
_saver_lock = threading.Lock()


def get_checkpointer() -> SqliteCheckpointer:
    global _saver
    with _saver_lock:
        if _saver is None:
            _saver = SqliteCheckpointer()
        return _saver


def reset_checkpointer() -> None:
    """测试用：丢弃单例（显式给路径时不影响其他用例）。"""
    global _saver
    with _saver_lock:
        _saver = None


def latest_state(db_path: Path, thread_id: str) -> dict[str, Any] | None:
    """取某线程最新 checkpoint 的 ``channel_values``（没有则 ``None``）。"""
    saver = SqliteCheckpointer(db_path)
    item = saver.get_tuple({"configurable": {"thread_id": thread_id}})
    if item is None:
        return None
    values = item.checkpoint.get("channel_values") or {}
    return dict(values) if isinstance(values, dict) else None


def has_resumable_turn(db_path: Path, thread_id: str) -> bool:
    state = latest_state(db_path, thread_id)
    return bool(state) and not str(state.get("reply") or "").strip()


def list_resumable(db_path: Path) -> list[dict[str, str]]:
    """列出「有 checkpoint 但还没产出答复」的线程（最新一条为准）。"""
    if not db_path.exists():
        return []
    SqliteCheckpointer(db_path)._connect().close()  # 确保表存在
    with sqlite3.connect(db_path, timeout=15) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT thread_id, created_at, reply FROM agent_checkpoints "
            "WHERE checkpoint_ns = '' ORDER BY created_at DESC, rowid DESC"
        ).fetchall()
    seen: set[str] = set()
    out: list[dict[str, str]] = []
    for row in rows:
        thread_id = str(row["thread_id"])
        if thread_id in seen:
            continue
        seen.add(thread_id)
        if str(row["reply"] or "").strip():
            continue
        out.append({"thread_id": thread_id, "created_at": str(row["created_at"])})
    return out


def discard_turn(db_path: Path, thread_id: str) -> None:
    SqliteCheckpointer(db_path).delete_thread(thread_id)


__all__ = [
    "SqliteCheckpointer",
    "checkpoint_enabled",
    "discard_turn",
    "get_checkpointer",
    "has_resumable_turn",
    "latest_state",
    "list_resumable",
    "reset_checkpointer",
    "thread_id_for",
]
