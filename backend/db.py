"""ChatVein SQLite 连接层：路径 / 引擎 / Session / 建库迁移 / 向量扩展。

业务表与 CRUD 不在此文件；各 NestJS 风格模块自带 entity / repository。
启动时 ``init_db()`` 会注册各模块实体后再 ``create_all``。

向量存储用 **sqlite-vec**（SQLite 可加载扩展）而非独立向量库：向量与业务数据
同库、同事务、同备份，且不用额外分发 pyarrow 之类的重型依赖。扩展需要逐连接
加载，已挂在 ``connect`` 事件上，业务侧可直接 ``CREATE VIRTUAL TABLE ... USING vec0``。
"""
# pyright: reportAny=false, reportExplicitAny=false, reportUnknownMemberType=false, reportUnknownVariableType=false, reportUnknownArgumentType=false, reportImplicitRelativeImport=false

import os
import re
import sqlite3
from collections.abc import Generator
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

import sqlite_vec
from sqlalchemy import Connection, Engine, create_engine, event, text
from sqlmodel import Session, SQLModel

# v1: 手写 sqlite3；v2: SQLModel；v3: llm_models；v4: conversations.workspace_dir；
# v5: 主库移除 messages（对话消息只存会话空间 session.sqlite）；
# v6: roles.resident_skills 常驻技能列；
# v7: llm_models 移除 is_default / is_primary 列（不再区分主/默认模型）；
# v8: conversations.skills 会话级技能列（JSON slug 列表，Composer 勾选、当前会话持续生效）。
# v9: roles.avatar 角色头像图标文件名列（空串用 initial 色块）。
# v10: roles.description 角色一句话描述列（列表副标题 / 群组花名册）。
# v11: conversations.group_members 群组成员列（JSON 角色 id 列表，@ 指派 / 团队模式）。
# v12: 群组 / 团队功能独立成 chats 模块：成员数据迁入独立表 chat_groups，删除 conversations.group_members 列。
# v13: conversations 冗余 message_count / last_message 列，列表 / 计数不再逐个打开会话空间库。
SCHEMA_VERSION = 13
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
    from chats.entity import ChatGroup  # noqa: F401
    from conversations.entity import Conversation  # noqa: F401
    from models.entity import LlmModel  # noqa: F401
    from roles.entity import Role  # noqa: F401

    _ = (Conversation, LlmModel, Role, ChatGroup)
    _entities_registered = True


def _normalise_v1_timestamps(connection: Connection) -> None:
    targets = (("conversations", ("created_at", "updated_at")),)
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


def _ensure_roles_resident_skills_column(connection: Connection) -> None:
    """v6：给旧库的 ``roles`` 表补上 ``resident_skills`` 列（JSON 文本）。"""
    rows = connection.exec_driver_sql("PRAGMA table_info(roles)").fetchall()
    names = {str(row[1]) for row in rows}
    if names and "resident_skills" not in names:
        connection.exec_driver_sql(
            "ALTER TABLE roles ADD COLUMN resident_skills VARCHAR(2048) NOT NULL DEFAULT '[]'"
        ).close()


def _ensure_roles_avatar_column(connection: Connection) -> None:
    """v9：给旧库的 ``roles`` 表补上 ``avatar`` 列（头像图标文件名）。"""
    rows = connection.exec_driver_sql("PRAGMA table_info(roles)").fetchall()
    names = {str(row[1]) for row in rows}
    if names and "avatar" not in names:
        connection.exec_driver_sql(
            "ALTER TABLE roles ADD COLUMN avatar VARCHAR(64) NOT NULL DEFAULT ''"
        ).close()
        # 内置主角色缺省绑定默认头像，其余角色保持空串（前端回退 initial 色块）。
        connection.exec_driver_sql(
            "UPDATE roles SET avatar = 'avatar-11.png' WHERE [primary] = 1 AND avatar = ''"
        ).close()


def _ensure_roles_description_column(connection: Connection) -> None:
    """v10：给旧库的 ``roles`` 表补上 ``description`` 列（一句话描述）。"""
    rows = connection.exec_driver_sql("PRAGMA table_info(roles)").fetchall()
    names = {str(row[1]) for row in rows}
    if names and "description" not in names:
        connection.exec_driver_sql(
            "ALTER TABLE roles ADD COLUMN description VARCHAR(200) NOT NULL DEFAULT ''"
        ).close()


def _ensure_conversations_skills_column(connection: Connection) -> None:
    """v8：给旧库的 ``conversations`` 表补上 ``skills`` 列（会话级技能 slug，JSON 文本）。"""
    rows = connection.exec_driver_sql("PRAGMA table_info(conversations)").fetchall()
    names = {str(row[1]) for row in rows}
    if names and "skills" not in names:
        connection.exec_driver_sql(
            "ALTER TABLE conversations ADD COLUMN skills VARCHAR(4096) NOT NULL DEFAULT '[]'"
        ).close()


def _ensure_conversations_preview_columns(connection: Connection) -> None:
    """v13：给旧库 ``conversations`` 补 ``message_count`` / ``last_message`` 冗余列。

    消息数 / 最后一条消息预览此前靠逐个打开会话空间库统计（N+1），现冗余到
    主库；写入路径（save_exchange / record_turn / delete_last_exchange）同步维护。
    """
    rows = connection.exec_driver_sql("PRAGMA table_info(conversations)").fetchall()
    names = {str(row[1]) for row in rows}
    if names and "message_count" not in names:
        connection.exec_driver_sql(
            "ALTER TABLE conversations ADD COLUMN message_count INTEGER NOT NULL DEFAULT 0"
        ).close()
    if names and "last_message" not in names:
        connection.exec_driver_sql(
            "ALTER TABLE conversations ADD COLUMN last_message VARCHAR(2048) NOT NULL DEFAULT ''"
        ).close()


def _backfill_conversation_previews(connection: Connection) -> None:
    """v13：为升级前的旧会话一次性回填 ``message_count`` / ``last_message``。

    只对「冗余列为空」的会话逐个打开空间库一次；迁移完成后列表 / 计数查询
    不再碰 session.sqlite。文件不存在 / 解析失败的会话跳过，不产生目录副作用。
    """
    try:
        from conversations import session_store  # pyright: ignore[reportImplicitRelativeImport]
        from mcps.sandbox import (  # pyright: ignore[reportImplicitRelativeImport]
            conversation_root,
            session_db_path,
        )
    except Exception:
        return
    convs = connection.exec_driver_sql(
        "SELECT id, workspace_dir FROM conversations "
        "WHERE message_count = 0 AND last_message = ''"
    ).fetchall()
    for cid, ws in convs:
        name = str(ws or "").strip()
        if not name:
            continue
        try:
            db_path = session_db_path(conversation_root(name))
        except ValueError:
            continue
        if not db_path.is_file():
            continue
        try:
            count, last = session_store.preview(db_path)
        except Exception:  # noqa: BLE001 — 单会话回填失败不影响整体迁移
            continue
        if count or last:
            connection.exec_driver_sql(
                "UPDATE conversations SET message_count = ?, last_message = ? WHERE id = ?",
                (count, (last or "")[:2048], str(cid)),
            ).close()


def _split_group_members_to_chat_groups(connection: Connection) -> None:
    """v12：把 conversations.group_members 存量数据搬到独立表 chat_groups 后删列。

    群组 / 团队（chats）模块自 v12 起独立管理成员花名册，不再占用 conversations 列。
    v11 之前的库没有该列（v11 才引入），探测到列存在才执行；新库由实体定义直接建新表。
    """
    import json

    rows = connection.exec_driver_sql("PRAGMA table_info(conversations)").fetchall()
    names = {str(row[1]) for row in rows}
    if "group_members" not in names:
        return
    now = utc_now().strftime("%Y-%m-%d %H:%M:%S")
    for cid, raw in connection.exec_driver_sql(
        "SELECT id, group_members FROM conversations"
    ).fetchall():
        try:
            loaded = json.loads(raw or "[]")
        except (TypeError, ValueError):
            continue
        if not isinstance(loaded, list):
            continue
        cleaned: list[str] = []
        seen: set[str] = set()
        for item in loaded:
            slug = str(item).strip()
            if not slug or slug in seen:
                continue
            seen.add(slug)
            cleaned.append(slug)
        if not cleaned:
            continue
        connection.exec_driver_sql(
            "INSERT OR IGNORE INTO chat_groups(conversation_id, members, created_at, updated_at) "
            "VALUES (?, ?, ?, ?)",
            (str(cid), json.dumps(cleaned, ensure_ascii=False), now, now),
        ).close()
    try:
        connection.exec_driver_sql("ALTER TABLE conversations DROP COLUMN group_members").close()
    except Exception as exc:  # noqa: BLE001 — 老 SQLite 不支持 DROP COLUMN
        print(
            f"CHATVEIN migrate drop conversations.group_members skipped: {exc}",
            flush=True,
        )


def _drop_llm_models_flag_columns(connection: Connection) -> None:
    """v7：删除 ``llm_models.is_default`` / ``is_primary`` 列（SQLite 3.35+ 支持 DROP COLUMN）。"""
    rows = connection.exec_driver_sql("PRAGMA table_info(llm_models)").fetchall()
    names = {str(row[1]) for row in rows}
    if not names:
        return
    for column in ("is_default", "is_primary"):
        if column in names:
            try:
                connection.exec_driver_sql(
                    f"ALTER TABLE llm_models DROP COLUMN {column}"
                ).close()
            except Exception as exc:  # noqa: BLE001 — 老 SQLite 不支持 DROP COLUMN
                print(
                    f"CHATVEIN migrate drop llm_models.{column} skipped: {exc}",
                    flush=True,
                )


def _drop_main_messages_table(connection: Connection) -> None:
    """v5：对话消息迁到会话空间后，删除主库 messages 表。"""
    rows = connection.exec_driver_sql(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='messages'"
    ).fetchall()
    if not rows:
        return
    # 尽量把尚未同步到 session 的主库消息迁过去（幂等：session 已有内容则跳过）
    try:
        from conversations import session_store  # pyright: ignore[reportImplicitRelativeImport]
        from mcps.sandbox import (  # pyright: ignore[reportImplicitRelativeImport]
            conversation_root,
            init_conversation_layout,
            session_db_path,
        )

        convs = connection.exec_driver_sql(
            "SELECT id, workspace_dir FROM conversations"
        ).fetchall()
        for conv in convs:
            cid = str(conv[0])
            ws = str(conv[1] or "").strip()
            if not ws:
                continue
            try:
                db_path = session_db_path(init_conversation_layout(conversation_root(ws)))
            except Exception:
                continue
            existing = session_store.list_messages(db_path, limit=1)
            if existing:
                continue
            msg_rows = connection.exec_driver_sql(
                "SELECT role, content, used_llm, route, turn_id, tokens, duration_ms, created_at "
                "FROM messages WHERE conversation_id = ? ORDER BY id",
                (cid,),
            ).fetchall()
            for m in msg_rows:
                role = str(m[0] or "")
                if role not in ("user", "assistant", "system"):
                    continue
                session_store.append_message(
                    db_path,
                    role,
                    str(m[1] or ""),
                    used_llm=bool(m[2]),
                    route=m[3],
                    turn_id=str(m[4] or "") or None,
                    tokens=int(m[5] or 0),
                    duration_ms=int(m[6] or 0),
                )
    except Exception as exc:  # noqa: BLE001 — 迁移失败不阻断启动，仍删表
        print(f"CHATVEIN migrate messages→session skipped: {exc}", flush=True)
    connection.exec_driver_sql("DROP TABLE IF EXISTS messages").close()


def _migrate(connection: Connection) -> None:
    current = int(connection.exec_driver_sql("PRAGMA user_version").scalar_one())
    if current == 1:
        _normalise_v1_timestamps(connection)
    SQLModel.metadata.create_all(connection)
    # 列补齐迁移无条件执行：各 *_ensure_* 自带 PRAGMA table_info 探测，幂等。
    # 不能按 user_version 门控——旧库若在“补列迁移加入代码之前”就已达到更高版本，
    # 版本号门控会让这些列永久缺失（create_all 不会给已存在表加列），导致运行期
    # “no such column” 500。
    _ensure_workspace_dir_column(connection)
    _ensure_roles_resident_skills_column(connection)
    _ensure_conversations_skills_column(connection)
    _ensure_roles_avatar_column(connection)
    _ensure_roles_description_column(connection)
    _ensure_conversations_preview_columns(connection)
    if current < 5:
        _drop_main_messages_table(connection)
    if current < 7:
        _drop_llm_models_flag_columns(connection)
    if current < 12:
        _split_group_members_to_chat_groups(connection)
    if current < 13:
        _backfill_conversation_previews(connection)
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


def _escape_identifier(name: str) -> str:
    """把表 / 列名安全地包成 SQLite 标识符（只允许字母、数字、下划线、点、$）。"""
    if not re.match(r"^[A-Za-z_][A-Za-z0-9_$.]*$", name):
        raise ValueError(f"非法标识符: {name}")
    return f'"{name}"'


def tables() -> list[dict[str, object]]:
    """库中所有非系统表 / 视图，含行数（视图返回 None）。"""
    with session_scope() as session:
        rows = session.execute(
            text(
                "SELECT name, type FROM sqlite_master "
                "WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' "
                "ORDER BY (type='table') DESC, name"
            )
        ).fetchall()
        result: list[dict[str, object]] = []
        for r in rows:
            name = str(r[0] or "")
            kind = str(r[1] or "table")
            sql_value = session.scalar(
                text("SELECT sql FROM sqlite_master WHERE name = :n AND type = :t"),
                {"n": name, "t": kind},
            )
            row_count: int | None = None
            if kind == "table":
                try:
                    value = session.scalar(text(f"SELECT count(*) FROM {_escape_identifier(name)}"))
                    row_count = int(value or 0)  # pyright: ignore[reportArgumentType]
                except Exception:  # noqa: BLE001 — 个别表 count 失败不阻断整体
                    row_count = None
            result.append(
                {
                    "name": name,
                    "type": kind,
                    "row_count": row_count,
                    "sql": str(sql_value or ""),
                }
            )
        return result


def table_detail(name: str, limit: int = 50, offset: int = 0) -> dict[str, object]:
    """一张表的字段定义 + 前若干行数据；limit/offset 由前端控制翻页。"""
    if not re.match(r"^[A-Za-z_][A-Za-z0-9_$.]*$", name):
        raise ValueError(f"非法表名: {name}")
    safe = _escape_identifier(name)
    limit_i = max(1, min(500, int(limit)))
    offset_i = max(0, int(offset))
    with session_scope() as session:
        master = session.scalar(
            text("SELECT sql FROM sqlite_master WHERE name = :n AND type IN ('table','view')"),
            {"n": name},
        )
        kind = session.scalar(
            text("SELECT type FROM sqlite_master WHERE name = :n"),
            {"n": name},
        )
        if not master:
            raise KeyError(f"表不存在: {name}")
        kind = str(kind or "table")
        is_table = kind == "table"

        if is_table:
            pragma_rows = session.execute(text(f"PRAGMA table_info({safe})")).fetchall()
            columns: list[dict[str, object]] = []
            for i, row in enumerate(pragma_rows):
                values = tuple(row)
                columns.append({
                    "cid": int(values[0]) if values[0] is not None else i,
                    "name": str(values[1]),
                    "type": (str(values[2]) if values[2] is not None else None),
                    "notnull": bool(values[3]),
                    "default": (str(values[4]) if values[4] is not None else None),
                    "pk": bool(values[5]),
                })
            total_value = session.scalar(text(f"SELECT count(*) FROM {safe}"))
            total = int(total_value or 0)  # pyright: ignore[reportArgumentType]
            data_rows = session.execute(
                text(f"SELECT * FROM {safe} LIMIT :l OFFSET :o"),
                {"l": limit_i, "o": offset_i},
            )
            raw_cols = tuple(data_rows.keys())
            row_tuples = data_rows.fetchall()
        else:
            # 视图无法 PRAGMA table_info；用一次 LIMIT 取出行并从中反推列名。
            view_result = session.execute(text(f"SELECT * FROM {safe} LIMIT :l"), {"l": limit_i})
            col_names = tuple(view_result.keys())
            raw_cols = col_names
            row_tuples = view_result.fetchall()
            total = None
            columns = [{"cid": i, "name": name, "type": None, "notnull": False, "default": None, "pk": False}
                       for i, name in enumerate(col_names)]

        rows_out: list[dict[str, object]] = []
        for tup in row_tuples:
            row: dict[str, object] = {}
            for i, value in enumerate(tup):
                key = raw_cols[i] if i < len(raw_cols) else f"c{i}"
                row[key] = _coerce_cell(value)
            rows_out.append(row)

        return {
            "name": name,
            "type": kind,
            "sql": str(master or ""),
            "columns": columns,
            "total": total,
            "limit": limit_i,
            "offset": offset_i,
            "rows": rows_out,
        }


def _coerce_cell(value: object) -> object:
    """把 SQLite 里的 BLOB / bytes 转成可读字符串，其他类型透传（JSON 序列化友好）。"""
    if value is None:
        return None
    if isinstance(value, (bytes, bytearray)):
        try:
            return value.decode("utf-8", errors="replace")
        except Exception:  # noqa: BLE001
            return repr(value)
    if isinstance(value, (int, float, str, bool)):
        return value
    # datetime / date 等对象兜底
    try:
        return value.isoformat() if hasattr(value, "isoformat") else str(value)
    except Exception:  # noqa: BLE001
        return str(value)


def info() -> dict[str, object]:
    """设置页用的数据库概况：连接层 + 业务表行数 + 文件占用 + 引擎信息。"""
    path = resolve_db_path()
    payload = stats()
    with session_scope() as session:
        conversations = int(_scalar(session, "SELECT count(*) FROM conversations", 0))  # pyright: ignore[reportArgumentType]
        journal_mode = str(_scalar(session, "PRAGMA journal_mode", ""))
        sqlite_version = str(_scalar(session, "SELECT sqlite_version()", ""))
        page_size = int(_scalar(session, "PRAGMA page_size", 0))  # pyright: ignore[reportArgumentType]
        page_count = int(_scalar(session, "PRAGMA page_count", 0))  # pyright: ignore[reportArgumentType]
        free_pages = int(_scalar(session, "PRAGMA freelist_count", 0))  # pyright: ignore[reportArgumentType]
    try:
        from conversations.service import ConversationsService  # pyright: ignore[reportImplicitRelativeImport]

        messages = int(ConversationsService().counts().get("messages") or 0)
    except Exception:  # noqa: BLE001
        messages = 0
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
