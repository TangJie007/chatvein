"""ChatVein SQLite 连接层：路径 / 引擎 / Session / 建库迁移 / 向量扩展。

业务表与 CRUD 不在此文件；各 NestJS 风格模块自带 entity / repository。
启动时 ``init_db()`` 会注册各模块实体后再 ``create_all``。

向量存储用 **sqlite-vec**（SQLite 可加载扩展）而非独立向量库：向量与业务数据
同库、同事务、同备份，且不用额外分发 pyarrow 之类的重型依赖。扩展需要逐连接
加载，已挂在 ``connect`` 事件上，业务侧可直接 ``CREATE VIRTUAL TABLE ... USING vec0``。
"""
# pyright: reportAny=false, reportExplicitAny=false, reportUnknownMemberType=false, reportUnknownVariableType=false, reportUnknownArgumentType=false, reportImplicitRelativeImport=false

import os
import sqlite3
from collections.abc import Generator
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

import sqlite_vec
from sqlalchemy import Connection, Engine, create_engine, event, text
from sqlmodel import Session, SQLModel

# v1: 手写 sqlite3；v2: SQLModel；v3: llm_models；v4: conversations.workspace_dir。
SCHEMA_VERSION = 4
DB_FILENAME = "chatvein.db"

_BACKEND_DIR = Path(__file__).resolve().parent
_db_path_cache: Path | None = None
_engine: Engine | None = None
_entities_registered = False
# sqlite-vec 加载失败的原因（成功时保持 None）。只用于诊断，不影响主流程可用。
_vec_error: str | None = None
_vec_warned = False


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


def _load_sqlite_vec(dbapi_connection: sqlite3.Connection, _record: object) -> None:
    """把 sqlite-vec 扩展载入该连接（之后 ``vec0`` 虚拟表与 ``vec_*`` 函数可用）。

    必须逐连接加载：SQLAlchemy 池化的是 DBAPI 连接，而扩展属于连接级状态。
    ``load_extension`` 默认关闭，加载前临时打开、加载后立即关掉，避免留下可被
    SQL 注入滥用的入口。加载失败不阻断启动 —— 会话 / 聊天等主流程不依赖向量，
    但会把原因打印到 stdout（Rust 侧会转发给前端）并由 ``stats()`` 暴露。
    """
    global _vec_error, _vec_warned
    try:
        dbapi_connection.enable_load_extension(True)
        try:
            sqlite_vec.load(dbapi_connection)
        finally:
            dbapi_connection.enable_load_extension(False)
    except Exception as exc:  # noqa: BLE001 — 扩展缺失要如实反馈，不能静默
        _vec_error = f"{type(exc).__name__}: {exc}"
        if not _vec_warned:
            _vec_warned = True
            print(f"CHATVEIN_VEC_UNAVAILABLE {_vec_error}", flush=True)


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
        event.listen(_engine, "connect", _load_sqlite_vec)
    return _engine


def vec_available() -> bool:
    """sqlite-vec 扩展是否可用（``vec0`` 虚拟表能否创建）。"""
    return _vec_error is None


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
    from roles.entity import Role  # noqa: F401

    _ = (Conversation, Message, LlmModel, Role)
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


def _ensure_workspace_dir_column(connection: Connection) -> None:
    """``create_all`` 不会给已有表加列。旧库补上会话工作区目录名。"""
    rows = connection.exec_driver_sql("PRAGMA table_info(conversations)").fetchall()
    names = {str(row[1]) for row in rows}
    if names and "workspace_dir" not in names:
        connection.exec_driver_sql(
            "ALTER TABLE conversations ADD COLUMN workspace_dir VARCHAR(64) NOT NULL DEFAULT ''"
        ).close()


def _ensure_message_metrics_columns(connection: Connection) -> None:
    """``create_all`` 不会给已有表加列。旧库补上本轮 token 用量与耗时。"""
    rows = connection.exec_driver_sql("PRAGMA table_info(messages)").fetchall()
    names = {str(row[1]) for row in rows}
    if not names:
        return
    for column, ddl in (
        ("tokens", "INTEGER NOT NULL DEFAULT 0"),
        ("duration_ms", "INTEGER NOT NULL DEFAULT 0"),
    ):
        if column not in names:
            connection.exec_driver_sql(
                f"ALTER TABLE messages ADD COLUMN {column} {ddl}"
            ).close()


def _ensure_messages_turn_id_column(connection: Connection) -> None:
    """``create_all`` 不会给已有表加列。旧库补上消息的 turn_id（关联会话工作区同一轮 trace）。"""
    rows = connection.exec_driver_sql("PRAGMA table_info(messages)").fetchall()
    names = {str(row[1]) for row in rows}
    if names and "turn_id" not in names:
        connection.exec_driver_sql(
            "ALTER TABLE messages ADD COLUMN turn_id VARCHAR(64) NOT NULL DEFAULT ''"
        ).close()


def _migrate(connection: Connection) -> None:
    current = int(connection.exec_driver_sql("PRAGMA user_version").scalar_one())
    if current == 1:
        _normalise_v1_timestamps(connection)
    SQLModel.metadata.create_all(connection)
    _ensure_workspace_dir_column(connection)
    _ensure_messages_turn_id_column(connection)
    _ensure_message_metrics_columns(connection)
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

    print(f"CHATVEIN_VEC loaded={vec_available()}", flush=True)
    return path


def _scalar(session: Session, statement: str, default: object = "") -> object:
    """查一个标量，异常时回落到 ``default``（缺表 / 扩展未加载时用得上）。"""
    try:
        value = session.scalar(text(statement))
    except Exception:  # noqa: BLE001 — 诊断字段不允许把整个请求打挂
        return default
    return value if value is not None else default


def _vec_version(session: Session) -> str | None:
    """sqlite-vec 版本号；扩展不可用时返回 None。"""
    if not vec_available():
        return None
    try:
        value = session.scalar(text("SELECT vec_version()"))
    except Exception:  # noqa: BLE001 — 扩展被卸载等边缘情况只影响诊断字段
        return None
    return str(value) if value is not None else None


def stats() -> dict[str, object]:
    """连接层概况（不含业务表计数）。"""
    path = resolve_db_path()
    with session_scope() as session:
        version = session.scalar(text("PRAGMA user_version")) or 0
        vec_version = _vec_version(session)
    return {
        "path": str(path),
        "exists": path.exists(),
        "schema_version": int(version),
        "vector_extension": {
            "loaded": vec_available(),
            "version": vec_version,
            "error": _vec_error,
        },
    }


def info() -> dict[str, object]:
    """设置页用的数据库概况：连接层 + 业务表行数 + 文件占用 + 引擎信息。"""
    path = resolve_db_path()
    payload = stats()
    with session_scope() as session:
        conversations = int(_scalar(session, "SELECT count(*) FROM conversations", 0))  # pyright: ignore[reportArgumentType]
        messages = int(_scalar(session, "SELECT count(*) FROM messages", 0))  # pyright: ignore[reportArgumentType]
        journal_mode = str(_scalar(session, "PRAGMA journal_mode", ""))
        sqlite_version = str(_scalar(session, "SELECT sqlite_version()", ""))
        page_size = int(_scalar(session, "PRAGMA page_size", 0))  # pyright: ignore[reportArgumentType]
        page_count = int(_scalar(session, "PRAGMA page_count", 0))  # pyright: ignore[reportArgumentType]
        free_pages = int(_scalar(session, "PRAGMA freelist_count", 0))  # pyright: ignore[reportArgumentType]
    size_bytes = path.stat().st_size if path.exists() else 0
    payload.update(
        {
            "conversations": conversations,
            "messages": messages,
            "journal_mode": journal_mode.lower(),
            "sqlite_version": sqlite_version,
            "size_bytes": size_bytes,
            # WAL 下主库里尚未 checkpoint 的页不计入文件大小，这里给出逻辑容量
            "logical_bytes": page_size * page_count,
            "page_count": page_count,
            "free_pages": free_pages,
        }
    )
    return payload


def vacuum() -> dict[str, object]:
    """重建数据库文件并回收空闲页（VACUUM 不能在事务里执行）。"""
    raw = get_engine().raw_connection()
    try:
        driver = raw.connection
        previous = driver.isolation_level
        driver.isolation_level = None
        try:
            driver.execute("VACUUM")
        finally:
            driver.isolation_level = previous
    finally:
        raw.close()
    return info()


def backup() -> dict[str, object]:
    """把当前库（含 WAL）复制成同目录的 ``<name>.bak-<时间戳>``。"""
    path = resolve_db_path()
    if not path.exists():
        raise FileNotFoundError(f"数据库文件不存在：{path}")
    stamp = utc_now().strftime("%Y%m%d-%H%M%S")
    target = path.with_name(f"{path.stem}.bak-{stamp}{path.suffix}")
    # WAL 模式：用 SQLite 的 backup API 才能拿到包含未 checkpoint 页的一致快照
    source = sqlite3.connect(path)
    try:
        destination = sqlite3.connect(target)
        try:
            source.backup(destination)
        finally:
            destination.close()
    finally:
        source.close()
    return {
        "path": str(path),
        "backup_path": str(target),
        "size_bytes": target.stat().st_size,
    }
