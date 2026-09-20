"""ChatVein SQLite 连接层：路径 / 引擎 / Session / 建库迁移。

业务表与 CRUD 不在此文件；各 NestJS 风格模块自带 entity / repository。
启动时 ``init_db()`` 会注册各模块实体后再 ``create_all``。
"""
# pyright: reportAny=false, reportExplicitAny=false, reportUnknownMemberType=false, reportUnknownVariableType=false, reportUnknownArgumentType=false, reportImplicitRelativeImport=false

import os
import sqlite3
from collections.abc import Generator
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import Connection, Engine, create_engine, event, text
from sqlmodel import Session, SQLModel

# v1: 手写 sqlite3；v2: SQLModel；v3: llm_models。
SCHEMA_VERSION = 3
DB_FILENAME = "chatvein.db"

_BACKEND_DIR = Path(__file__).resolve().parent
_db_path_cache: Path | None = None
_engine: Engine | None = None
_entities_registered = False


def utc_now() -> datetime:
    """naive UTC：SQLite 不保存时区，统一按 UTC 存。"""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def iso(value: datetime) -> str:
    """输出 ISO-8601（秒精度，带时区），前端可直接 ``new Date()``。"""
    aware = value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value
    return aware.astimezone(timezone.utc).isoformat(timespec="seconds")


def resolve_db_path() -> Path:
    """优先级：``CHATVEIN_DB_PATH`` > ``CHATVEIN_DATA_DIR``/chatvein.db > ``backend/data/``。"""
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
    cursor = dbapi_connection.cursor()
    _ = cursor.execute("PRAGMA foreign_keys = ON")
    _ = cursor.execute("PRAGMA busy_timeout = 5000")
    cursor.close()


def get_engine() -> Engine:
    """进程内单例引擎。"""
    global _engine
    if _engine is None:
        path = resolve_db_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        _engine = create_engine(
            f"sqlite:///{path.as_posix()}",
            echo=False,
            connect_args={"check_same_thread": False},
        )
        event.listen(_engine, "connect", _set_sqlite_pragmas)
    return _engine


@contextmanager
def session_scope() -> Generator[Session, None, None]:
    """一个事务内的 Session：正常退出提交，异常回滚，最后关闭。"""
    with Session(get_engine()) as session:
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise


def register_entities() -> None:
    """导入各模块实体，确保 ``SQLModel.metadata`` 能看见全部表。"""
    global _entities_registered
    if _entities_registered:
        return
    from conversations.entity import Conversation, Message  # noqa: F401
    from models.entity import LlmModel  # noqa: F401

    _ = (Conversation, Message, LlmModel)
    _entities_registered = True


def _normalise_v1_timestamps(connection: Connection) -> None:
    targets = (("conversations", ("created_at", "updated_at")), ("messages", ("created_at",)))
    for table, columns in targets:
        for column in columns:
            statement = (
                f"UPDATE {table} SET {column} ="  # noqa: S608
                + f" replace(replace({column}, 'T', ' '), '+00:00', '')"
                + f" WHERE {column} LIKE '%T%'"
            )
            connection.exec_driver_sql(statement).close()


def _migrate(connection: Connection) -> None:
    current = int(connection.exec_driver_sql("PRAGMA user_version").scalar_one())
    if current == 1:
        _normalise_v1_timestamps(connection)
    SQLModel.metadata.create_all(connection)
    if current != SCHEMA_VERSION:
        connection.exec_driver_sql(f"PRAGMA user_version = {SCHEMA_VERSION}").close()


def init_db() -> Path:
    """建库 / 建表 / 迁移，返回数据库文件路径。"""
    register_entities()
    path = resolve_db_path()
    engine = get_engine()

    with engine.connect() as connection:
        connection.exec_driver_sql("PRAGMA journal_mode = WAL").close()

    with engine.begin() as connection:
        _migrate(connection)

    return path


def stats() -> dict[str, object]:
    """连接层概况（不含业务表计数）。"""
    path = resolve_db_path()
    with session_scope() as session:
        version = session.scalar(text("PRAGMA user_version")) or 0
    return {
        "path": str(path),
        "exists": path.exists(),
        "schema_version": int(version),
    }
