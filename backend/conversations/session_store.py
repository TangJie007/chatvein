"""会话空间 ``logs/session.sqlite``：短期记忆、工具返回、会话元数据。"""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

_TOOL_CALLS_DDL = """
CREATE TABLE tool_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    turn_id TEXT,
    tool_name TEXT NOT NULL,
    tool_call_id TEXT,
    arguments_json TEXT,
    result_text TEXT,
    status TEXT NOT NULL DEFAULT 'ok',
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tool_calls_turn ON tool_calls(turn_id);
"""

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
    turn_id TEXT,
    route_reason TEXT,
    tool_plan TEXT,
    created_at TEXT NOT NULL
);
""" + _TOOL_CALLS_DDL.replace("CREATE TABLE", "CREATE TABLE IF NOT EXISTS", 1) + """
CREATE INDEX IF NOT EXISTS idx_messages_id ON messages(id);
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
    """创建或升级会话库 schema。

    ``messages`` 表增量加列（幂等）；``tool_calls.turn_id`` 需为 TEXT 以存放 turn uuid，
    旧版本（INTEGER）直接重建该表（仅丢失历史工具轨迹，会随对话重新生成）。
    """
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with _connect(db_path) as conn:
        conn.executescript(_SCHEMA)
        conn.execute(
            "INSERT OR IGNORE INTO meta(key, value) VALUES ('schema_version', '1')"
        )
        _add_column(conn, "messages", "turn_id", "TEXT")
        _add_column(conn, "messages", "route_reason", "TEXT")
        _add_column(conn, "messages", "tool_plan", "TEXT")
        cols = {
            str(r[1]): str(r[2])
            for r in conn.execute("PRAGMA table_info(tool_calls)").fetchall()
        }
        if cols.get("turn_id", "").upper() != "TEXT":
            conn.execute("DROP TABLE IF EXISTS tool_calls")
            conn.executescript(_TOOL_CALLS_DDL)
    return db_path


def _add_column(conn: sqlite3.Connection, table: str, column: str, ctype: str) -> None:
    try:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ctype}")
    except sqlite3.OperationalError as exc:
        if "duplicate column" in str(exc).lower():
            return
        raise


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
    turn_id: str | None = None,
    route_reason: str | None = None,
    tool_plan: str | None = None,
) -> int:
    with _connect(db_path) as conn:
        cur = conn.execute(
            "INSERT INTO messages(role, content, route, used_llm, turn_id, "
            "route_reason, tool_plan, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                role,
                content,
                route,
                1 if used_llm else 0,
                turn_id or None,
                route_reason,
                tool_plan,
                _iso_now(),
            ),
        )
        return int(cur.lastrowid or 0)


def delete_last_exchange(db_path: Path) -> int:
    """撤回 / 停止：删除会话空间里最近一轮（用户句 + 助手句 + 该轮工具轨迹）。

    用户句在 ``record_turn`` 中不带 ``turn_id``，故按「助手句 id 的前一条」定位并删除；
    工具轨迹按助手句的 ``turn_id`` 删除。返回 1 表示已删除，0 表示本轮尚未落库。
    """
    with _connect(db_path) as conn:
        row = conn.execute(
            "SELECT id, turn_id FROM messages "
            "WHERE role = 'assistant' AND turn_id IS NOT NULL AND turn_id != '' "
            "ORDER BY id DESC LIMIT 1"
        ).fetchone()
        if row is None:
            return 0
        assistant_id = int(row["id"])
        turn_id = row["turn_id"]
        conn.execute(
            "DELETE FROM messages WHERE id = ? OR (role = 'user' AND id = ? - 1)",
            (assistant_id, assistant_id),
        )
        conn.execute("DELETE FROM tool_calls WHERE turn_id = ?", (turn_id,))
        return 1


def list_messages(db_path: Path, *, limit: int = 40) -> list[dict[str, Any]]:
    """按时间正序返回最近 ``limit`` 条（短期记忆窗口）。"""
    limit = max(1, min(int(limit), 200))
    with _connect(db_path) as conn:
        rows = conn.execute(
            "SELECT id, role, content, route, used_llm, turn_id, created_at "
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
            "turn_id": str(r["turn_id"] or ""),
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
    turn_id: str | None = None,
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
            "turn_id": str(r["turn_id"]) if r["turn_id"] is not None else None,
            "tool_name": str(r["tool_name"]),
            "tool_call_id": r["tool_call_id"],
            "arguments_json": r["arguments_json"],
            "result_text": str(r["result_text"] or ""),
            "status": str(r["status"]),
            "created_at": str(r["created_at"]),
        }
        for r in reversed(rows)
    ]


def list_reasoning(db_path: Path) -> list[dict[str, Any]]:
    """返回每个有 turn_id 的助手消息的推理文本（route_reason / tool_plan）。"""
    with _connect(db_path) as conn:
        rows = conn.execute(
            "SELECT turn_id, route_reason, tool_plan FROM messages "
            "WHERE role = 'assistant' AND turn_id IS NOT NULL AND turn_id != ''"
        ).fetchall()
    return [
        {
            "turn_id": str(r["turn_id"]),
            "route_reason": str(r["route_reason"] or ""),
            "tool_plan": str(r["tool_plan"] or ""),
        }
        for r in rows
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
