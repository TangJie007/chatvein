"""ChatVein 的 SQLite 持久化层。

设计原则：
- **零新增依赖**：只用标准库 ``sqlite3``（打包用的 standalone Python 自带），
  不需要 ORM / 驱动，`requirements.txt` 保持不变。
- **位置由消息层决定**：数据库目录由 Rust 通过 ``CHATVEIN_DATA_DIR`` 注入
  （打包后指向系统用户数据目录，避免写入只读的 resources 目录）；
  也可用 ``CHATVEIN_DB_PATH`` 直接指定文件；两者都缺失时回落到 ``backend/data/``，
  方便脱离 Tauri 直接跑后端调试。
- **并发安全**：每次调用新建连接（桌面场景开销可忽略），开启 WAL 让读不阻塞写，
  并设置 ``busy_timeout`` 兜住瞬时写冲突。
- **可演进**：使用 ``PRAGMA user_version`` 记录 schema 版本，后续加表/改表在
  ``_migrate`` 中增量追加即可。
"""
# sqlite3.Row 的取值是 Any，本模块通过显式 cast 收窄，故放宽该条规则。
# pyright: reportAny=false

from __future__ import annotations

import os
import sqlite3
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal, TypedDict, cast

# 角色限定为这三种，DB 层用 CHECK 约束兜底。
Role = Literal["user", "assistant", "system"]

SCHEMA_VERSION = 1
DB_FILENAME = "chatvein.db"
# 新会话自动用首条用户消息做标题，超出长度截断。
TITLE_MAX_LEN = 30

_BACKEND_DIR = Path(__file__).resolve().parent
_db_path_cache: Path | None = None


class MessageRecord(TypedDict):
    """messages 表中的一行。"""

    id: int
    conversation_id: str
    role: str
    content: str
    used_llm: bool
    route: str | None
    created_at: str


class ConversationRecord(TypedDict):
    """conversations 表中的一行（附带统计字段，便于列表直接展示）。"""

    id: str
    title: str
    created_at: str
    updated_at: str
    message_count: int
    last_message: str | None


def _utc_now() -> str:
    """统一的时间戳格式：UTC ISO-8601（秒精度），前端 Date 可直接解析。"""
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def resolve_db_path() -> Path:
    """解析数据库文件路径（结果在进程内缓存，保证全程一致）。

    优先级：``CHATVEIN_DB_PATH`` > ``CHATVEIN_DATA_DIR``/chatvein.db >
    ``<backend>/data/chatvein.db``。
    """
    global _db_path_cache
    if _db_path_cache is not None:
        return _db_path_cache

    explicit = os.environ.get("CHATVEIN_DB_PATH")
    if explicit:
        path = Path(explicit).expanduser()
    else:
        data_dir = os.environ.get("CHATVEIN_DATA_DIR")
        base = Path(data_dir).expanduser() if data_dir else _BACKEND_DIR / "data"
        path = base / DB_FILENAME

    _db_path_cache = path
    return path


@contextmanager
def connect(path: Path | None = None) -> Iterator[sqlite3.Connection]:
    """打开一个连接，正常退出时提交、异常时回滚、无论如何都关闭。"""
    target = path or resolve_db_path()
    target.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(target, timeout=10.0)
    conn.row_factory = sqlite3.Row
    # 外键默认关闭，必须逐连接开启；busy_timeout 避免并发写直接抛 locked。
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 5000")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


_SCHEMA = """
CREATE TABLE IF NOT EXISTS conversations (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role            TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content         TEXT NOT NULL,
    used_llm        INTEGER NOT NULL DEFAULT 0,
    route           TEXT,
    created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation
    ON messages (conversation_id, id);

CREATE INDEX IF NOT EXISTS idx_conversations_updated
    ON conversations (updated_at DESC);
"""


def _migrate(conn: sqlite3.Connection) -> None:
    """按 ``user_version`` 增量迁移。新增版本时在此追加分支即可。"""
    row = conn.execute("PRAGMA user_version").fetchone()
    current = 0 if row is None else cast(int, row[0])
    if current >= SCHEMA_VERSION:
        return

    if current < 1:
        conn.executescript(_SCHEMA)

    conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")


def init_db() -> Path:
    """建库建表并返回数据库文件路径，应在服务启动时调用一次。"""
    path = resolve_db_path()
    with connect(path) as conn:
        # WAL 是数据库级持久设置，只需设置一次；读写并发更好。
        conn.execute("PRAGMA journal_mode = WAL")
        _migrate(conn)
    return path


# --------------------------------------------------------------------------
# 行 -> 记录
# --------------------------------------------------------------------------
def _row_message(row: sqlite3.Row) -> MessageRecord:
    return MessageRecord(
        id=cast(int, row["id"]),
        conversation_id=cast(str, row["conversation_id"]),
        role=cast(str, row["role"]),
        content=cast(str, row["content"]),
        used_llm=bool(cast(int, row["used_llm"])),
        route=cast("str | None", row["route"]),
        created_at=cast(str, row["created_at"]),
    )


def _row_conversation(row: sqlite3.Row) -> ConversationRecord:
    keys = row.keys()
    return ConversationRecord(
        id=cast(str, row["id"]),
        title=cast(str, row["title"]),
        created_at=cast(str, row["created_at"]),
        updated_at=cast(str, row["updated_at"]),
        message_count=cast(int, row["message_count"]) if "message_count" in keys else 0,
        last_message=cast("str | None", row["last_message"])
        if "last_message" in keys
        else None,
    )


def _derive_title(text: str) -> str:
    title = " ".join(text.strip().split())
    if len(title) > TITLE_MAX_LEN:
        return title[:TITLE_MAX_LEN] + "…"
    return title or "新会话"


# --------------------------------------------------------------------------
# 会话
# --------------------------------------------------------------------------
def create_conversation(title: str = "") -> ConversationRecord:
    """新建会话；标题为空时先留空，等首条消息自动补上。"""
    now = _utc_now()
    conversation_id = uuid.uuid4().hex
    with connect() as conn:
        conn.execute(
            "INSERT INTO conversations (id, title, created_at, updated_at)"
            " VALUES (?, ?, ?, ?)",
            (conversation_id, title.strip(), now, now),
        )
    return ConversationRecord(
        id=conversation_id,
        title=title.strip(),
        created_at=now,
        updated_at=now,
        message_count=0,
        last_message=None,
    )


_SELECT_PREFIX = """
SELECT c.id,
       c.title,
       c.created_at,
       c.updated_at,
       COUNT(m.id) AS message_count,
       (SELECT content FROM messages
         WHERE conversation_id = c.id
         ORDER BY id DESC LIMIT 1) AS last_message
  FROM conversations c
  LEFT JOIN messages m ON m.conversation_id = c.id
"""
_GROUP_BY = "\n GROUP BY c.id, c.title, c.created_at, c.updated_at\n"
_LIST_SQL = _SELECT_PREFIX + _GROUP_BY + " ORDER BY c.updated_at DESC\n LIMIT ?"
_GET_SQL = _SELECT_PREFIX + " WHERE c.id = ?" + _GROUP_BY


def list_conversations(limit: int = 50) -> list[ConversationRecord]:
    with connect() as conn:
        rows = conn.execute(_LIST_SQL, (limit,)).fetchall()
    return [_row_conversation(row) for row in rows]


def get_conversation(conversation_id: str) -> ConversationRecord | None:
    with connect() as conn:
        rows = conn.execute(_GET_SQL, (conversation_id,)).fetchall()
    return _row_conversation(rows[0]) if rows else None


def delete_conversation(conversation_id: str) -> bool:
    """删除会话；messages 依靠外键级联一起删除。"""
    with connect() as conn:
        cursor = conn.execute("DELETE FROM conversations WHERE id = ?", (conversation_id,))
    return cursor.rowcount > 0


def clear_conversations() -> int:
    """清空全部会话与消息，返回删除的会话数。"""
    with connect() as conn:
        cursor = conn.execute("DELETE FROM conversations")
        conn.execute("DELETE FROM sqlite_sequence WHERE name = 'messages'")
    return cursor.rowcount


def _touch(conn: sqlite3.Connection, conversation_id: str, now: str) -> None:
    conn.execute(
        "UPDATE conversations SET updated_at = ? WHERE id = ?",
        (now, conversation_id),
    )


# --------------------------------------------------------------------------
# 消息
# --------------------------------------------------------------------------
def add_message(
    conversation_id: str,
    role: Role,
    content: str,
    *,
    used_llm: bool = False,
    route: str | None = None,
) -> MessageRecord:
    """追加一条消息，并刷新所属会话的 updated_at。"""
    now = _utc_now()
    with connect() as conn:
        cursor = conn.execute(
            "INSERT INTO messages (conversation_id, role, content, used_llm, route, created_at)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (conversation_id, role, content, int(used_llm), route, now),
        )
        _touch(conn, conversation_id, now)
        message_id = cast(int, cursor.lastrowid)
    return MessageRecord(
        id=message_id,
        conversation_id=conversation_id,
        role=role,
        content=content,
        used_llm=used_llm,
        route=route,
        created_at=now,
    )


def list_messages(conversation_id: str, limit: int = 200) -> list[MessageRecord]:
    """按时间正序返回会话内的消息（最多 limit 条）。"""
    with connect() as conn:
        rows = conn.execute(
            "SELECT * FROM messages WHERE conversation_id = ? ORDER BY id ASC LIMIT ?",
            (conversation_id, limit),
        ).fetchall()
    return [_row_message(row) for row in rows]


def ensure_conversation(conversation_id: str | None, title_hint: str = "") -> str:
    """返回可用的会话 id：传入的 id 存在则复用，否则新建（含标题推导）。"""
    if conversation_id:
        with connect() as conn:
            row = conn.execute(
                "SELECT id FROM conversations WHERE id = ?", (conversation_id,)
            ).fetchone()
        if row is not None:
            return cast(str, row["id"])

    return create_conversation(_derive_title(title_hint))["id"]


def save_exchange(
    conversation_id: str | None,
    user_text: str,
    reply_text: str,
    *,
    used_llm: bool = False,
    route: str | None = None,
    title_hint: str | None = None,
) -> tuple[str, MessageRecord, MessageRecord]:
    """一次事务写入「用户消息 + 助手回复」，返回 (会话 id, 用户消息, 助手消息)。

    - ``conversation_id`` 为空（或已失效）时自动新建会话；
    - 会话标题为空时用 ``title_hint or user_text`` 自动补齐。
    """
    now = _utc_now()
    hint = _derive_title(title_hint or user_text)

    with connect() as conn:
        # 1) 定位/创建会话
        target_id = conversation_id
        if target_id:
            row = conn.execute(
                "SELECT id FROM conversations WHERE id = ?", (target_id,)
            ).fetchone()
            if row is None:
                target_id = None
        if not target_id:
            target_id = uuid.uuid4().hex
            conn.execute(
                "INSERT INTO conversations (id, title, created_at, updated_at)"
                " VALUES (?, ?, ?, ?)",
                (target_id, hint, now, now),
            )
        else:
            conn.execute(
                "UPDATE conversations SET title = ?"
                " WHERE id = ? AND (title IS NULL OR title = '')",
                (hint, target_id),
            )

        # 2) 写入两条消息
        cursor = conn.execute(
            "INSERT INTO messages (conversation_id, role, content, used_llm, route, created_at)"
            " VALUES (?, 'user', ?, 0, ?, ?)",
            (target_id, user_text, route, now),
        )
        user_id = cast(int, cursor.lastrowid)

        cursor = conn.execute(
            "INSERT INTO messages (conversation_id, role, content, used_llm, route, created_at)"
            " VALUES (?, 'assistant', ?, ?, ?, ?)",
            (target_id, reply_text, int(used_llm), route, now),
        )
        assistant_id = cast(int, cursor.lastrowid)

        _touch(conn, target_id, now)

    return (
        target_id,
        MessageRecord(
            id=user_id,
            conversation_id=target_id,
            role="user",
            content=user_text,
            used_llm=False,
            route=route,
            created_at=now,
        ),
        MessageRecord(
            id=assistant_id,
            conversation_id=target_id,
            role="assistant",
            content=reply_text,
            used_llm=used_llm,
            route=route,
            created_at=now,
        ),
    )


def stats() -> dict[str, object]:
    """数据库概况，供 /api/health 与调试接口展示。"""
    path = resolve_db_path()
    with connect() as conn:
        conversations = cast(
            int, conn.execute("SELECT COUNT(*) FROM conversations").fetchone()[0]
        )
        messages = cast(int, conn.execute("SELECT COUNT(*) FROM messages").fetchone()[0])
        row = conn.execute("PRAGMA user_version").fetchone()
        version = 0 if row is None else cast(int, row[0])
    return {
        "path": str(path),
        "exists": path.exists(),
        "schema_version": version,
        "conversations": conversations,
        "messages": messages,
    }
