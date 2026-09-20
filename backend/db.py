"""ChatVein 的 SQLite 持久化层（SQLModel / SQLAlchemy ORM）。

设计原则：
- **ORM 优先**：表结构用 SQLModel 声明（一个类 = 一张表），查询走 SQLAlchemy 2.0 的
  `select()`，不手写 SQL 字符串。SQLModel 由 SQLAlchemy + Pydantic 驱动，和项目已有的
  pydantic / FastAPI 生态同源；后续加字段、加关联、加迁移都只需改模型。
- **位置由消息层决定**：数据库目录由 Rust 通过 ``CHATVEIN_DATA_DIR`` 注入（打包后指向
  用户数据目录，避免写入只读的 resources 目录）；也可用 ``CHATVEIN_DB_PATH`` 直接指定
  文件；两者都缺失时回落到 ``backend/data/``，方便脱离 Tauri 直接调试后端。
- **时间统一 naive UTC**：SQLite 的 DATETIME 不保存时区，因此库内一律存 naive UTC，
  对外输出时补回 ``+00:00``（前端不用做任何区分）。
- **并发安全**：连接级 PRAGMA（外键 / busy_timeout）+ WAL 日志模式，读写不互相阻塞。
- **可演进**：``PRAGMA user_version`` 记录 schema 版本，改表时在 ``_migrate`` 里追加分支，
  缺表由 ``SQLModel.metadata.create_all`` 自动补齐。
"""
# SQLModel/SQLAlchemy 的泛型在编译期无法完全具体化，Session/Row 会带出 Unknown；
# 这里只在本文件放宽这几条基于第三方宽松类型的规则，不影响项目其它文件。
#
# 注意：**不要**在本文件加 `from __future__ import annotations`。PEP 563 会把
# `list["Message"]` 变成字符串 `"list['Message']"` 传给 SQLAlchemy 的 relationship()，
# 导致 mapper 初始化失败（InvalidRequestError: using a generic class as the argument）。
# pyright: reportAny=false, reportUnknownMemberType=false, reportUnknownVariableType=false, reportUnknownArgumentType=false, reportImplicitRelativeImport=false

import os
import sqlite3
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal, TypedDict

from sqlalchemy import CheckConstraint, Connection, Engine, create_engine, delete, event, func, text
from sqlmodel import Field, Relationship, Session, SQLModel, select

# 角色限定为这三种，同时用 CHECK 约束在数据库层兜底。
Role = Literal["user", "assistant", "system"]

# v1: 手写 sqlite3；v2: SQLModel（时间戳存储格式随之规范化）。
SCHEMA_VERSION = 2
DB_FILENAME = "chatvein.db"
# 新会话自动用首条用户消息做标题，超出长度截断。
TITLE_MAX_LEN = 30

_BACKEND_DIR = Path(__file__).resolve().parent
_db_path_cache: Path | None = None
_engine: Engine | None = None


# --------------------------------------------------------------------------
# 表模型
# --------------------------------------------------------------------------
class Conversation(SQLModel, table=True):
    """会话。"""

    __tablename__ = "conversations"

    id: str = Field(default_factory=lambda: uuid.uuid4().hex, primary_key=True, max_length=64)
    title: str = Field(default="", max_length=200)
    created_at: datetime = Field(default_factory=lambda: _utc_now())
    updated_at: datetime = Field(default_factory=lambda: _utc_now())

    # ORM 级联：删除会话对象时一并删除其消息。
    messages: list["Message"] = Relationship(back_populates="conversation", cascade_delete=True)


class Message(SQLModel, table=True):
    """一条消息（user / assistant / system）。"""

    __tablename__ = "messages"
    __table_args__ = (
        CheckConstraint(
            "role IN ('user', 'assistant', 'system')",
            name="ck_messages_role",
        ),
    )

    id: int | None = Field(default=None, primary_key=True)
    conversation_id: str = Field(
        foreign_key="conversations.id",
        # 数据库层兜底：直接删行（不经 ORM）时同样级联。
        ondelete="CASCADE",
        index=True,
        max_length=64,
    )
    role: str = Field(max_length=16)
    content: str = Field()
    used_llm: bool = Field(default=False)
    route: str | None = Field(default=None, max_length=32)
    created_at: datetime = Field(default_factory=lambda: _utc_now())

    conversation: Conversation | None = Relationship(back_populates="messages")


# --------------------------------------------------------------------------
# 对外记录类型（HTTP 契约，前端 src/api.ts 与此一一对应）
# --------------------------------------------------------------------------
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


# --------------------------------------------------------------------------
# 时间与序列化
# --------------------------------------------------------------------------
def _utc_now() -> datetime:
    """naive UTC：SQLite 不保存时区，统一按 UTC 存以避免歧义。"""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _iso(value: datetime) -> str:
    """输出 ISO-8601（秒精度，带时区），前端 `new Date()` 可直接解析。"""
    aware = value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value
    return aware.astimezone(timezone.utc).isoformat(timespec="seconds")


def _message_dict(message: Message) -> MessageRecord:
    return MessageRecord(
        id=int(message.id or 0),
        conversation_id=message.conversation_id,
        role=message.role,
        content=message.content,
        used_llm=message.used_llm,
        route=message.route,
        created_at=_iso(message.created_at),
    )


def _conversation_dict(
    conversation: Conversation,
    message_count: int = 0,
    last_message: str | None = None,
) -> ConversationRecord:
    return ConversationRecord(
        id=conversation.id,
        title=conversation.title,
        created_at=_iso(conversation.created_at),
        updated_at=_iso(conversation.updated_at),
        message_count=message_count,
        last_message=last_message,
    )


def _derive_title(value: str) -> str:
    title = " ".join(value.strip().split())
    if len(title) > TITLE_MAX_LEN:
        return title[:TITLE_MAX_LEN] + "…"
    return title or "新会话"


# --------------------------------------------------------------------------
# 路径 / 引擎 / 会话
# --------------------------------------------------------------------------
def resolve_db_path() -> Path:
    """解析数据库文件路径（进程内缓存，保证全程一致）。

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


def _set_sqlite_pragmas(dbapi_connection: sqlite3.Connection, _record: object) -> None:
    """SQLite 的外键默认关闭，必须逐连接开启；顺带设置写锁等待。"""
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys = ON")
    cursor.execute("PRAGMA busy_timeout = 5000")
    cursor.close()


def get_engine() -> Engine:
    """进程内单例引擎；路径在首次使用时才解析，便于测试改环境变量。"""
    global _engine
    if _engine is None:
        path = resolve_db_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        _engine = create_engine(
            f"sqlite:///{path.as_posix()}",
            echo=False,
            # FastAPI 的同步端点跑在线程池里，连接会跨线程复用。
            connect_args={"check_same_thread": False},
        )
        event.listen(_engine, "connect", _set_sqlite_pragmas)
    return _engine


@contextmanager
def session_scope() -> Iterator[Session]:
    """一个事务内的 Session：正常退出提交，异常回滚，最后关闭。"""
    with Session(get_engine()) as session:
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise


# --------------------------------------------------------------------------
# 初始化与迁移
# --------------------------------------------------------------------------
def _normalise_v1_timestamps(connection: Connection) -> None:
    """把 v1 的时间戳（``2026-01-01T00:00:00+00:00``）规范成 ORM 读得懂的格式。

    v1 是手写 SQL 写入的，带 ``T`` 分隔符与 ``+00:00``；SQLModel 的 DateTime 列
    期望 ``2026-01-01 00:00:00``（naive UTC）。只改含 ``T`` 的行，可重复执行。
    """
    targets = (("conversations", ("created_at", "updated_at")), ("messages", ("created_at",)))
    for table, columns in targets:
        for column in columns:
            connection.exec_driver_sql(
                f"UPDATE {table} SET {column} = replace(replace({column}, 'T', ' '), '+00:00', '')"  # noqa: S608
                f" WHERE {column} LIKE '%T%'"
            )


def _migrate(connection: Connection) -> None:
    """按 ``user_version`` 增量迁移；新增版本时在此追加分支即可。"""
    current = int(connection.exec_driver_sql("PRAGMA user_version").scalar_one())

    if current == 1:
        _normalise_v1_timestamps(connection)

    # 幂等：新建库时建表，老库缺表时补齐。
    SQLModel.metadata.create_all(connection)

    if current != SCHEMA_VERSION:
        connection.exec_driver_sql(f"PRAGMA user_version = {SCHEMA_VERSION}")


def init_db() -> Path:
    """建库/建表/迁移，返回数据库文件路径。应在服务启动时调用一次。"""
    path = resolve_db_path()
    engine = get_engine()

    # WAL 是数据库级持久设置，且必须在事务外执行，因此单独用一个连接设置一次。
    with engine.connect() as connection:
        connection.exec_driver_sql("PRAGMA journal_mode = WAL")

    with engine.begin() as connection:
        _migrate(connection)

    return path


# --------------------------------------------------------------------------
# 会话
# --------------------------------------------------------------------------
def _conversation_statement(limit: int | None = None):
    """会话列表查询：附带消息数与最后一条消息，按最近活跃排序。"""
    last_message = (
        select(Message.content)
        .where(Message.conversation_id == Conversation.id)
        .order_by(Message.id.desc())
        .limit(1)
        # 外层已经 JOIN 了 messages，不加 correlate 会被自动关联掉 FROM 子句。
        .correlate(Conversation)
        .scalar_subquery()
    )
    statement = (
        select(Conversation, func.count(Message.id), last_message)
        .outerjoin(Message, Message.conversation_id == Conversation.id)
        .group_by(Conversation.id)
        .order_by(Conversation.updated_at.desc())
    )
    return statement.limit(limit) if limit is not None else statement


def create_conversation(title: str = "") -> ConversationRecord:
    """新建会话；标题为空时先留空，等首条消息自动补上。"""
    with session_scope() as session:
        conversation = Conversation(title=title.strip())
        session.add(conversation)
        return _conversation_dict(conversation)


def list_conversations(limit: int = 50) -> list[ConversationRecord]:
    with session_scope() as session:
        rows = session.exec(_conversation_statement(limit)).all()
        return [
            _conversation_dict(conversation, count, last) for conversation, count, last in rows
        ]


def get_conversation(conversation_id: str) -> ConversationRecord | None:
    with session_scope() as session:
        rows = session.exec(
            _conversation_statement().where(Conversation.id == conversation_id)
        ).all()
        if not rows:
            return None
        conversation, count, last = rows[0]
        return _conversation_dict(conversation, count, last)


def delete_conversation(conversation_id: str) -> bool:
    """删除会话；其消息由 ORM 级联（并叠加数据库级 CASCADE）一并删除。"""
    with session_scope() as session:
        conversation = session.get(Conversation, conversation_id)
        if conversation is None:
            return False
        session.delete(conversation)
    return True


def clear_conversations() -> int:
    """清空全部会话与消息，返回删除的会话数。"""
    with session_scope() as session:
        # 先删子表再删父表：不依赖数据库是否开外键级联，语义也更直白。
        # synchronize_session=False：Session 随后即销毁，无需回写内存对象。
        session.execute(delete(Message).execution_options(synchronize_session=False))
        result = session.execute(
            delete(Conversation).execution_options(synchronize_session=False)
        )
        return int(result.rowcount or 0)


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
    with session_scope() as session:
        conversation = session.get(Conversation, conversation_id)
        if conversation is None:
            raise ValueError(f"会话不存在: {conversation_id}")

        message = Message(
            conversation_id=conversation_id,
            role=role,
            content=content,
            used_llm=used_llm,
            route=route,
            created_at=now,
        )
        session.add(message)
        conversation.updated_at = now
        session.flush()
        return _message_dict(message)


def list_messages(conversation_id: str, limit: int = 200) -> list[MessageRecord]:
    """按时间正序返回会话内的消息（最多 limit 条）。"""
    statement = (
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.id)
        .limit(limit)
    )
    with session_scope() as session:
        return [_message_dict(message) for message in session.exec(statement).all()]


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

    with session_scope() as session:
        conversation = session.get(Conversation, conversation_id) if conversation_id else None
        if conversation is None:
            conversation = Conversation(title=hint, created_at=now, updated_at=now)
            session.add(conversation)
        elif not conversation.title:
            conversation.title = hint

        user_message = Message(
            conversation_id=conversation.id,
            role="user",
            content=user_text,
            route=route,
            created_at=now,
        )
        assistant_message = Message(
            conversation_id=conversation.id,
            role="assistant",
            content=reply_text,
            used_llm=used_llm,
            route=route,
            created_at=now,
        )
        session.add(user_message)
        session.add(assistant_message)
        conversation.updated_at = now

        session.flush()
        return (
            conversation.id,
            _message_dict(user_message),
            _message_dict(assistant_message),
        )


def stats() -> dict[str, object]:
    """数据库概况，供 /api/health 与调试接口展示。"""
    path = resolve_db_path()
    with session_scope() as session:
        conversations = session.scalar(select(func.count()).select_from(Conversation)) or 0
        messages = session.scalar(select(func.count()).select_from(Message)) or 0
        version = session.execute(text("PRAGMA user_version")).scalar_one()
    return {
        "path": str(path),
        "exists": path.exists(),
        "schema_version": int(version),
        "conversations": int(conversations),
        "messages": int(messages),
    }
