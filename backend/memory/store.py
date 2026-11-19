"""长期记忆的存储层：独立 SQLite 文件（默认 ``<data>/memory.sqlite``）。

设计要点：

- **独立库**：记忆每轮都要召回，读写频繁；放主库会跟业务实体一起迁移、备份、
  vacuum，用户想「一键清空我的画像」也更麻烦。
- **裸 SQL**：与 ``conversations/session_store.py`` 同风格，避免为了一个 9 列表
  引入 ORM 实体与迁移链；schema 只追加不改列。
- **内容去重靠哈希**：``(scope, scope_id, content_hash)`` 唯一，重复抽取同一事实
  只会合并置信度，不会长出第二条。
"""

from __future__ import annotations

import os
import re
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

#: ``scope_id`` 用空串而不是 NULL：唯一索引里 NULL 互不相等，会把去重放过去。
_SCHEMA = """
CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL DEFAULT 'global',
    scope_id TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'fact',
    content TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 0.6,
    status TEXT NOT NULL DEFAULT 'pending',
    source_turn_id TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    expires_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_hash
    ON memories(scope, scope_id, content_hash);
CREATE INDEX IF NOT EXISTS idx_memories_status
    ON memories(status, updated_at);
"""

_MAX_LIST = 500


def _iso_now() -> str:
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat(timespec="seconds")


def memory_db_path() -> Path:
    """记忆库路径：``CHATVEIN_MEMORY_DB_PATH`` > 主库同目录的 ``memory.sqlite``。

    跟着主库走的好处：测试 / 自定义 ``CHATVEIN_DB_PATH`` 时记忆库自动落到同一临时
    目录，不会污染用户真实数据。
    """
    explicit = (os.environ.get("CHATVEIN_MEMORY_DB_PATH") or "").strip()
    if explicit:
        return Path(explicit).expanduser()
    from db import resolve_db_path  # pyright: ignore[reportImplicitRelativeImport]

    return resolve_db_path().with_name("memory.sqlite")


_initialized: set[str] = set()
_init_lock = threading.Lock()


@contextmanager
def _connect(path: Path) -> Iterator[sqlite3.Connection]:
    # 抽取在线程里跑（fire-and-forget），连接必须允许跨线程。
    conn = sqlite3.connect(path, timeout=10, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    try:
        with conn:
            yield conn
    finally:
        conn.close()


def ensure_memory_db(path: Path | None = None) -> Path:
    """建库建表（幂等，进程内只做一次）。"""
    target = path or memory_db_path()
    key = str(target.resolve())
    if key in _initialized:
        return target
    with _init_lock:
        if key in _initialized:
            return target
        target.parent.mkdir(parents=True, exist_ok=True)
        with _connect(target) as conn:
            conn.execute("PRAGMA journal_mode = WAL").close()
            conn.executescript(_SCHEMA)
        _initialized.add(key)
    return target


#: 归一化时抹掉的字符：空白与中英文标点。这样「用户偏好 Markdown 表格」与
#: 「用户偏好markdown表格。」归一后相等，不会因为写法差异长出两条记忆。
_NOISE = re.compile(r"[\s，。、；：！？,.;:!?'\"（）()【】\[\]]+")


def normalize_content(text: str) -> str:
    return _NOISE.sub("", (text or "").lower())


def content_hash(scope: str, scope_id: str, content: str) -> str:
    """规范化后哈希：大小写 / 空白 / 标点差异不产生新记忆。"""
    return f"{scope}:{scope_id}:{normalize_content(content)}"


def _row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "scope": row["scope"],
        "scope_id": row["scope_id"],
        "kind": row["kind"],
        "content": row["content"],
        "confidence": float(row["confidence"]),
        "status": row["status"],
        "source_turn_id": row["source_turn_id"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "expires_at": row["expires_at"],
    }


def upsert(
    path: Path,
    *,
    memory_id: str,
    scope: str,
    scope_id: str,
    kind: str,
    content: str,
    confidence: float,
    status: str,
    source_turn_id: str = "",
    expires_at: str | None = None,
) -> tuple[str, bool]:
    """写入一条记忆；命中同一 ``(scope, scope_id, 内容哈希)`` 时合并。

    合并规则：内容取更长的、置信度取更高的（重复出现 +0.05，上限 1.0）、
    已确认的不会被后到的候选降级。返回 ``(id, 是否新增)``。
    """
    target = ensure_memory_db(path)
    digest = content_hash(scope, scope_id, content)
    now = _iso_now()
    with _connect(target) as conn:
        row = conn.execute(
            "SELECT id, content, confidence, status FROM memories "
            "WHERE scope = ? AND scope_id = ? AND content_hash = ?",
            (scope, scope_id, digest),
        ).fetchone()
        if row is not None:
            keep_content = (
                content if len(content) > len(str(row["content"])) else str(row["content"])
            )
            merged_status = (
                "active" if status == "active" or row["status"] == "active" else row["status"]
            )
            conn.execute(
                "UPDATE memories SET content = ?, confidence = ?, status = ?, "
                "updated_at = ?, source_turn_id = ?, expires_at = ? WHERE id = ?",
                (
                    keep_content,
                    min(1.0, max(float(row["confidence"]), float(confidence)) + 0.05),
                    merged_status,
                    now,
                    source_turn_id or "",
                    expires_at,
                    row["id"],
                ),
            )
            return str(row["id"]), False
        conn.execute(
            "INSERT INTO memories (id, scope, scope_id, kind, content, content_hash, "
            "confidence, status, source_turn_id, created_at, updated_at, expires_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                memory_id,
                scope,
                scope_id,
                kind,
                content,
                digest,
                float(confidence),
                status,
                source_turn_id,
                now,
                now,
                expires_at,
            ),
        )
        return memory_id, True


def list_memories(
    path: Path,
    *,
    status: str | None = None,
    scope: str | None = None,
    limit: int = _MAX_LIST,
) -> list[dict[str, Any]]:
    target = ensure_memory_db(path)
    limit = max(1, min(int(limit), _MAX_LIST))
    clauses: list[str] = []
    params: list[Any] = []
    if status:
        clauses.append("status = ?")
        params.append(status)
    if scope:
        clauses.append("scope = ?")
        params.append(scope)
    where = f"WHERE {' AND '.join(clauses)} " if clauses else ""
    with _connect(target) as conn:
        rows = conn.execute(
            "SELECT id, scope, scope_id, kind, content, confidence, status, "
            "source_turn_id, created_at, updated_at, expires_at FROM memories "
            f"{where}ORDER BY updated_at DESC LIMIT ?",
            (*params, limit),
        ).fetchall()
    return [_row_to_dict(row) for row in rows]


def active_for(
    path: Path,
    *,
    role_id: str | None = None,
    conversation_id: str | None = None,
    limit: int = _MAX_LIST,
) -> list[dict[str, Any]]:
    """召回候选：全局 + 本角色 + 本会话的已确认记忆（过期的不给）。"""
    target = ensure_memory_db(path)
    now = _iso_now()
    with _connect(target) as conn:
        rows = conn.execute(
            "SELECT id, scope, scope_id, kind, content, confidence, status, "
            "source_turn_id, created_at, updated_at, expires_at FROM memories "
            "WHERE status = 'active' AND (expires_at IS NULL OR expires_at > ?) "
            "AND (scope = 'global' "
            "OR (scope = 'role' AND scope_id = ?) "
            "OR (scope = 'conversation' AND scope_id = ?)) "
            "ORDER BY updated_at DESC LIMIT ?",
            (now, role_id or "", conversation_id or "", max(1, min(int(limit), _MAX_LIST))),
        ).fetchall()
    return [_row_to_dict(row) for row in rows]


def get_memory(path: Path, memory_id: str) -> dict[str, Any] | None:
    target = ensure_memory_db(path)
    with _connect(target) as conn:
        row = conn.execute(
            "SELECT id, scope, scope_id, kind, content, confidence, status, "
            "source_turn_id, created_at, updated_at, expires_at FROM memories "
            "WHERE id = ?",
            (memory_id,),
        ).fetchone()
    return _row_to_dict(row) if row is not None else None


def update_memory(path: Path, memory_id: str, fields: dict[str, Any]) -> dict[str, Any] | None:
    """局部更新（内容变了一并刷新哈希，避免和别的记忆撞去重）。"""
    target = ensure_memory_db(path)
    existing = get_memory(target, memory_id)
    if existing is None:
        return None
    updates = {key: value for key, value in fields.items() if value is not None}
    if "content" in updates:
        updates["content_hash"] = content_hash(
            str(existing["scope"]), str(existing["scope_id"]), str(updates["content"])
        )
    updates["updated_at"] = _iso_now()
    columns = ", ".join(f"{key} = ?" for key in updates)
    with _connect(target) as conn:
        conn.execute(
            f"UPDATE memories SET {columns} WHERE id = ?",
            (*list(updates.values()), memory_id),
        )
    return get_memory(target, memory_id)


def delete_memory(path: Path, memory_id: str) -> bool:
    target = ensure_memory_db(path)
    with _connect(target) as conn:
        cursor = conn.execute("DELETE FROM memories WHERE id = ?", (memory_id,))
    return cursor.rowcount > 0


def purge_expired(path: Path) -> int:
    """清掉过期记忆（``expires_at`` 早于当下的）。"""
    target = ensure_memory_db(path)
    now = _iso_now()
    with _connect(target) as conn:
        cursor = conn.execute(
            "DELETE FROM memories WHERE expires_at IS NOT NULL AND expires_at <= ?", (now,)
        )
    return int(cursor.rowcount or 0)


def stats(path: Path) -> dict[str, Any]:
    target = ensure_memory_db(path)
    now = _iso_now()
    with _connect(target) as conn:
        total = int(conn.execute("SELECT count(*) FROM memories").fetchone()[0])
        active = int(
            conn.execute("SELECT count(*) FROM memories WHERE status = 'active'").fetchone()[0]
        )
        pending = int(
            conn.execute("SELECT count(*) FROM memories WHERE status = 'pending'").fetchone()[0]
        )
        expired = int(
            conn.execute(
                "SELECT count(*) FROM memories WHERE expires_at IS NOT NULL AND expires_at <= ?",
                (now,),
            ).fetchone()[0]
        )
    return {"total": total, "active": active, "pending": pending, "expired": expired}
