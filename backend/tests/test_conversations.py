"""会话落库：复用 id、失效 id 新建、删除级联。"""

from conversations.service import ConversationsService


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
