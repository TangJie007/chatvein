"""会话落库：元数据主库 + 消息会话空间库。"""

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
    assert stored["message_count"] == 4


def test_unknown_conversation_id_starts_a_new_one() -> None:
    service = ConversationsService()
    conversation_id, _, _ = service.save_exchange("missing", "孤儿", "新会话")
    assert conversation_id != "missing"
    assert service.get_conversation("missing") is None


def test_delete_cascades_workspace() -> None:
    service = ConversationsService()
    conversation_id, _, _ = service.save_exchange(None, "hi", "hello")
    counts = service.counts()
    assert counts["conversations"] == 1
    assert counts["messages"] == 2

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


def test_delete_last_exchange_respects_after_message_id() -> None:
    """相同文案连发时，仅靠原文不够；必须要求 id 大于发送前 baseline。"""
    service = ConversationsService()
    conversation_id, _, _ = service.save_exchange(None, "同样的问题", "答一")
    before = service.list_messages(conversation_id)
    baseline = max(int(m["id"]) for m in before)

    assert (
        service.delete_last_exchange(
            conversation_id,
            user_content="同样的问题",
            after_message_id=baseline,
        )
        == 0
    )
    assert len(service.list_messages(conversation_id)) == 2

    service.save_exchange(conversation_id, "同样的问题", "答二")
    assert (
        service.delete_last_exchange(
            conversation_id,
            user_content="同样的问题",
            after_message_id=baseline,
        )
        == 2
    )
    left = service.list_messages(conversation_id)
    assert len(left) == 2
    assert left[1]["content"] == "答一"


def test_messages_live_only_in_session_db() -> None:
    """主库不再有 messages 表；消息只在会话空间。"""
    service = ConversationsService()
    conversation_id, _, assistant = service.save_exchange(
        None, "只在工作区", "好的", tokens=12, duration_ms=34
    )
    stored = service.get_conversation(conversation_id)
    assert stored is not None
    db = session_db_path(service.workspace_root_for(stored["workspace_dir"]))
    with sqlite3.connect(db) as conn:
        n = conn.execute("SELECT count(*) FROM messages").fetchone()[0]
        row = conn.execute(
            "SELECT tokens, duration_ms FROM messages WHERE role='assistant' ORDER BY id DESC LIMIT 1"
        ).fetchone()
    assert n == 2
    assert row is not None
    assert int(row[0]) == 12
    assert int(row[1]) == 34
    assert assistant["tokens"] == 12

    from db import resolve_db_path

    main = resolve_db_path()
    with sqlite3.connect(main) as conn:
        tables = {
            r[0]
            for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
    assert "messages" not in tables
