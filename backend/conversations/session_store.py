"""会话空间 ``logs/session.sqlite``：对话消息、工具返回、会话元数据。

主库不再存 messages；UI 历史与 Agent 短期记忆都读这里。
"""

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
    tokens INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    actor_id TEXT,
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
    """创建或升级会话库 schema。"""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with _connect(db_path) as conn:
        conn.executescript(_SCHEMA)
        conn.execute(
            "INSERT OR IGNORE INTO meta(key, value) VALUES ('schema_version', '1')"
        )
        _add_column(conn, "messages", "turn_id", "TEXT")
        _add_column(conn, "messages", "route_reason", "TEXT")
        _add_column(conn, "messages", "tool_plan", "TEXT")
        _add_column(conn, "messages", "tokens", "INTEGER NOT NULL DEFAULT 0")
        _add_column(conn, "messages", "duration_ms", "INTEGER NOT NULL DEFAULT 0")
        _add_column(conn, "messages", "actor_id", "TEXT")
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
    tokens: int = 0,
    duration_ms: int = 0,
    actor_id: str | None = None,
) -> int:
    ensure_session_db(db_path)
    with _connect(db_path) as conn:
        cur = conn.execute(
            "INSERT INTO messages(role, content, route, used_llm, turn_id, "
            "route_reason, tool_plan, tokens, duration_ms, actor_id, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                role,
                content,
                route,
                1 if used_llm else 0,
                turn_id or None,
                route_reason,
                tool_plan,
                int(tokens or 0),
                int(duration_ms or 0),
                actor_id or None,
                _iso_now(),
            ),
        )
        return int(cur.lastrowid or 0)


def delete_last_exchange(
    db_path: Path,
    *,
    user_content: str | None = None,
    after_message_id: int | None = None,
) -> int:
    """撤回 / 停止：删除最近一轮（助手句，必要时连带它前面的用户句 + 该轮工具轨迹）。

    群里 @ 多人时同一句提问只落一次，尾部会连续出现多条助手回复，因此这里
    以「最后一条消息」为准：它是助手就先删它；只有它前面紧邻着本轮用户句时
    才一并删掉用户句（连续调用即可逐条清掉多轮，最后顺带清掉提问）。

    防护：``user_content`` 须匹配最近的用户句；``after_message_id`` 须小于它。
    返回删除的消息条数（0 / 1 / 2）。
    """
    ensure_session_db(db_path)
    with _connect(db_path) as conn:
        rows = conn.execute(
            "SELECT id, role, content, turn_id FROM messages ORDER BY id DESC LIMIT 8"
        ).fetchall()
        if not rows:
            return 0
        last_user = next((r for r in rows if str(r["role"]) == "user"), None)
        if user_content is not None:
            expected = user_content.strip()
            if last_user is None or str(last_user["content"] or "").strip() != expected:
                return 0
        if after_message_id is not None:
            if last_user is None:
                return 0
            if int(last_user["id"]) <= int(after_message_id):
                return 0

        # 先删最后一条（助手回复）；它前面若就是本轮用户句，一并删掉。
        ids = [int(rows[0]["id"])]
        prev = rows[1] if len(rows) > 1 else None
        if prev is not None and str(prev["role"]) == "user":
            if user_content is None or str(prev["content"] or "").strip() == user_content.strip():
                ids.append(int(prev["id"]))
        placeholders = ",".join("?" * len(ids))
        conn.execute(f"DELETE FROM messages WHERE id IN ({placeholders})", ids)
        assistant = next((r for r in rows if str(r["role"]) == "assistant"), None)
        if assistant is not None and assistant["turn_id"]:
            conn.execute(
                "DELETE FROM tool_calls WHERE turn_id = ?",
                (str(assistant["turn_id"]),),
            )
        return len(ids)


def list_messages(
    db_path: Path, *, limit: int = 200, actor_id: str | None = None
) -> list[dict[str, Any]]:
    """按时间正序返回最近 ``limit`` 条。

    ``actor_id`` 非空时只返回该角色名下消息——团队模式下每个成员按
    ``actor_id`` 隔离短期记忆，互不串线。
    """
    ensure_session_db(db_path)
    limit = max(1, min(int(limit), 500))
    with _connect(db_path) as conn:
        if actor_id:
            rows = conn.execute(
                "SELECT id, role, content, route, used_llm, turn_id, "
                "tokens, duration_ms, actor_id, created_at "
                "FROM messages WHERE actor_id = ? ORDER BY id DESC LIMIT ?",
                (actor_id, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT id, role, content, route, used_llm, turn_id, "
                "tokens, duration_ms, actor_id, created_at "
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
            "tokens": int(r["tokens"] or 0),
            "duration_ms": int(r["duration_ms"] or 0),
            "actor_id": r["actor_id"],
            "created_at": str(r["created_at"]),
        }
        for r in ordered
    ]


def preview(db_path: Path) -> tuple[int, str | None]:
    """返回 (message_count, last_message_content)。"""
    if not db_path.is_file():
        return 0, None
    ensure_session_db(db_path)
    with _connect(db_path) as conn:
        count = int(conn.execute("SELECT count(*) FROM messages").fetchone()[0])
        row = conn.execute(
            "SELECT content FROM messages ORDER BY id DESC LIMIT 1"
        ).fetchone()
    last = str(row["content"]) if row else None
    return count, last


def apply_turn_metrics(db_path: Path, by_turn: dict[str, tuple[int, int]]) -> int:
    """按 turn_id 补全 assistant 的 tokens / duration_ms。"""
    if not by_turn:
        return 0
    ensure_session_db(db_path)
    updated = 0
    with _connect(db_path) as conn:
        for turn_id, (tokens, duration_ms) in by_turn.items():
            cur = conn.execute(
                "UPDATE messages SET "
                "tokens = CASE WHEN tokens = 0 AND ? > 0 THEN ? ELSE tokens END, "
                "duration_ms = CASE WHEN duration_ms = 0 AND ? > 0 THEN ? ELSE duration_ms END "
                "WHERE role = 'assistant' AND turn_id = ?",
                (tokens, tokens, duration_ms, duration_ms, turn_id),
            )
            updated += int(cur.rowcount or 0)
    return updated


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
    ensure_session_db(db_path)
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
    ensure_session_db(db_path)
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
    """返回每个有 turn_id 的助手消息的推理文本。"""
    ensure_session_db(db_path)
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
