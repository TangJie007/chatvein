"""会话落库：复用 id、失效 id 新建、删除级联。"""

import sqlite3
from pathlib import Path

from conversations.service import ConversationsService
from conversations.session_store import ensure_session_db
from mcps.sandbox import session_db_path


def test_save_exchange_reuses_conversation_and_truncates_title() -> None:
    service = ConversationsService()
    long_text = "问" * 40
    conversation_id, user_message, _assistant = service.save_exchange(None, long_text, "好的")

    again, _, _ = service.save_exchange(conversation_id, "再问一次", "继续")
    assert again == conversation_id

    stored = service.get_conversation(conversation_id)
    assert stored is not None
    assert stored["title"].endswith("…")
    assert len(stored["title"]) == 31
    assert user_message["role"] == "user"
    roles = [message["role"] for message in service.list_messages(conversation_id)]
    assert roles == ["user", "assistant", "user", "assistant"]


def test_unknown_conversation_id_starts_a_new_one() -> None:
    service = ConversationsService()
    conversation_id, _, _ = service.save_exchange("missing", "孤儿", "新会话")
    assert conversation_id != "missing"
    assert service.get_conversation("missing") is None


def test_delete_cascades_messages() -> None:
    service = ConversationsService()
    conversation_id, _, _ = service.save_exchange(None, "hi", "hello")
    assert service.counts() == {"conversations": 1, "messages": 2}

    assert service.delete_conversation(conversation_id) is True
    assert service.counts() == {"conversations": 0, "messages": 0}
    assert service.delete_conversation(conversation_id) is False


def test_session_db_upgrades_integer_tool_call_turn_id(tmp_path: Path) -> None:
    """旧库 ``tool_calls.turn_id`` 是整数时，打开会话库要能升到 TEXT。"""
    db = tmp_path / "logs" / "session.sqlite"
    db.parent.mkdir(parents=True)
    with sqlite3.connect(db) as conn:
        conn.executescript(
            """
            CREATE TABLE tool_calls (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                turn_id INTEGER,
                tool_name TEXT NOT NULL,
                tool_call_id TEXT,
                arguments_json TEXT,
                result_text TEXT,
                status TEXT NOT NULL DEFAULT 'ok',
                created_at TEXT NOT NULL
            );
            """
        )
    ensure_session_db(db)
    with sqlite3.connect(db) as conn:
        cols = {
            str(row[1]): str(row[2]).upper()
            for row in conn.execute("PRAGMA table_info(tool_calls)")
        }
    assert cols["turn_id"] == "TEXT"


def test_workspace_root_survives_legacy_tool_calls_schema() -> None:
    service = ConversationsService()
    conversation_id, _, _ = service.save_exchange(None, "hi", "hello")
    stored = service.get_conversation(conversation_id)
    assert stored is not None
    db = session_db_path(service.workspace_root_for(stored["workspace_dir"]))
    with sqlite3.connect(db) as conn:
        conn.execute("DROP TABLE IF EXISTS tool_calls")
        conn.executescript(
            """
            CREATE TABLE tool_calls (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                turn_id INTEGER,
                tool_name TEXT NOT NULL,
                tool_call_id TEXT,
                arguments_json TEXT,
                result_text TEXT,
                status TEXT NOT NULL DEFAULT 'ok',
                created_at TEXT NOT NULL
            );
            """
        )
    # 再次打开布局（追踪列表也会走这条路径）不能 500
    again = session_db_path(service.workspace_root_for(stored["workspace_dir"]))
    assert again == db
    with sqlite3.connect(db) as conn:
        turn_type = str(
            conn.execute(
                "SELECT type FROM pragma_table_info('tool_calls') WHERE name='turn_id'"
            ).fetchone()[0]
        ).upper()
    assert turn_type == "TEXT"


def test_delete_last_exchange_requires_matching_user_content() -> None:
    """停止生成时若本轮尚未落库，不得误删上一轮历史。"""
    service = ConversationsService()
    conversation_id, _, _ = service.save_exchange(None, "第一问", "第一答")
    service.save_exchange(conversation_id, "第二问", "第二答")

    assert service.delete_last_exchange(conversation_id, user_content="尚未发送的内容") == 0
    roles = [m["role"] for m in service.list_messages(conversation_id)]
    assert roles == ["user", "assistant", "user", "assistant"]

    assert service.delete_last_exchange(conversation_id, user_content="第二问") == 2
    roles = [m["role"] for m in service.list_messages(conversation_id)]
    assert roles == ["user", "assistant"]
    assert service.list_messages(conversation_id)[0]["content"] == "第一问"


def test_rehydrate_messages_from_session_when_main_empty() -> None:
    """主库消息被清空后，应从会话空间短期记忆回填。"""
    service = ConversationsService()
    conversation_id, _, _ = service.save_exchange(None, "回填问", "回填答")
    stored = service.get_conversation(conversation_id)
    assert stored is not None
    ws = stored["workspace_dir"]
    service.record_turn(ws, user_text="回填问", reply_text="回填答", turn_id="t-rehydrate")

    # 模拟误删主库消息
    from conversations.repository import ConversationsRepository
    from db import session_scope
    from conversations.entity import Message
    from sqlmodel import delete
    from sqlalchemy import ColumnElement
    from typing import Any, cast

    with session_scope() as session:
        session.exec(
            delete(Message)
            .where(cast("ColumnElement[Any]", Message.conversation_id) == conversation_id)
            .execution_options(synchronize_session=False)
        )

    assert ConversationsRepository().list_messages(conversation_id) == []
    restored = service.list_messages(conversation_id)
    assert len(restored) >= 2
    assert restored[0]["content"] == "回填问"
    assert restored[1]["content"] == "回填答"

