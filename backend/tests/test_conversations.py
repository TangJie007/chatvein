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
