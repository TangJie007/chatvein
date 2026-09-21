"""会话空间 ``logs/session.sqlite``：短期记忆、工具返回、会话元数据。"""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

_SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
    content TEXT NOT NULL,
    route TEXT,
    used_llm INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tool_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    turn_id INTEGER,
    tool_name TEXT NOT NULL,
    tool_call_id TEXT,
    arguments_json TEXT,
    result_text TEXT,
    status TEXT NOT NULL DEFAULT 'ok',
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_id ON messages(id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_turn ON tool_calls(turn_id);
"""


def _iso_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


@contextmanager
def _connect(db_path: Path) -> Iterator[sqlite3.Connection]:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path), timeout=30)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def ensure_session_db(db_path: Path) -> Path:
    """创建或升级会话库 schema。"""
    with _connect(db_path) as conn:
        conn.executescript(_SCHEMA)
        conn.execute(
            "INSERT OR IGNORE INTO meta(key, value) VALUES ('schema_version', '1')"
        )
    return db_path


def set_meta(db_path: Path, key: str, value: str) -> None:
    with _connect(db_path) as conn:
        conn.execute(
            "INSERT INTO meta(key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )


def get_meta(db_path: Path, key: str) -> str | None:
    with _connect(db_path) as conn:
        row = conn.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
        return str(row["value"]) if row else None


def append_message(
    db_path: Path,
    role: str,
    content: str,
    *,
    route: str | None = None,
    used_llm: bool = False,
) -> int:
    with _connect(db_path) as conn:
        cur = conn.execute(
            "INSERT INTO messages(role, content, route, used_llm, created_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (role, content, route, 1 if used_llm else 0, _iso_now()),
        )
        return int(cur.lastrowid or 0)


def list_messages(db_path: Path, *, limit: int = 40) -> list[dict[str, Any]]:
    """按时间正序返回最近 ``limit`` 条（短期记忆窗口）。"""
    limit = max(1, min(int(limit), 200))
    with _connect(db_path) as conn:
        rows = conn.execute(
            "SELECT id, role, content, route, used_llm, created_at "
            "FROM messages ORDER BY id DESC LIMIT ?",
            (limit,),
        ).fetchall()
    ordered = list(reversed(rows))
    return [
        {
            "id": int(r["id"]),
            "role": str(r["role"]),
            "content": str(r["content"]),
            "route": r["route"],
            "used_llm": bool(r["used_llm"]),
            "created_at": str(r["created_at"]),
        }
        for r in ordered
    ]


def append_tool_call(
    db_path: Path,
    *,
    tool_name: str,
    result_text: str = "",
    arguments: Any = None,
    tool_call_id: str | None = None,
    turn_id: int | None = None,
    status: str = "ok",
) -> int:
    args_json = None
    if arguments is not None:
        try:
            args_json = json.dumps(arguments, ensure_ascii=False, default=str)
        except TypeError:
            args_json = json.dumps(str(arguments), ensure_ascii=False)
    clipped = result_text if len(result_text) <= 50_000 else result_text[:50_000] + "\n…(截断)"
    with _connect(db_path) as conn:
        cur = conn.execute(
            "INSERT INTO tool_calls("
            "turn_id, tool_name, tool_call_id, arguments_json, result_text, status, created_at"
            ") VALUES (?, ?, ?, ?, ?, ?, ?)",
            (turn_id, tool_name, tool_call_id, args_json, clipped, status, _iso_now()),
        )
        return int(cur.lastrowid or 0)


def list_tool_calls(db_path: Path, *, limit: int = 50) -> list[dict[str, Any]]:
    limit = max(1, min(int(limit), 200))
    with _connect(db_path) as conn:
        rows = conn.execute(
            "SELECT id, turn_id, tool_name, tool_call_id, arguments_json, "
            "result_text, status, created_at "
            "FROM tool_calls ORDER BY id DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [
        {
            "id": int(r["id"]),
            "turn_id": r["turn_id"],
            "tool_name": str(r["tool_name"]),
            "tool_call_id": r["tool_call_id"],
            "arguments_json": r["arguments_json"],
            "result_text": str(r["result_text"] or ""),
            "status": str(r["status"]),
            "created_at": str(r["created_at"]),
        }
        for r in reversed(rows)
    ]


def list_artifacts(output_path: Path) -> list[dict[str, Any]]:
    """扫描 ``output/`` 下的产物文件（非递归到隐藏目录）。"""
    if not output_path.is_dir():
        return []
    items: list[dict[str, Any]] = []
    for path in sorted(output_path.rglob("*")):
        if not path.is_file():
            continue
        if any(part.startswith(".") for part in path.relative_to(output_path).parts):
            continue
        try:
            stat = path.stat()
        except OSError:
            continue
        rel = path.relative_to(output_path).as_posix()
        items.append(
            {
                "name": path.name,
                "path": f"output/{rel}",
                "size_bytes": int(stat.st_size),
                "modified_at": datetime.fromtimestamp(
                    stat.st_mtime, tz=timezone.utc
                )
                .replace(microsecond=0)
                .isoformat(),
            }
        )
    return items[:100]
