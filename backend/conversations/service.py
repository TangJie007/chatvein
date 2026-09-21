"""会话业务逻辑。"""

from .entity import ConversationRecord, CreateConversationDto, MessageRecord, Role
from .repository import ConversationsRepository


class ConversationsService:
    def __init__(self, repository: ConversationsRepository | None = None) -> None:
        self._repo = repository or ConversationsRepository()

    def list_conversations(self, limit: int = 50) -> list[ConversationRecord]:
        return self._repo.list(limit)

    def create_conversation(self, dto: CreateConversationDto) -> ConversationRecord:
        return self._repo.create(dto.title)

    def get_conversation(self, conversation_id: str) -> ConversationRecord | None:
        return self._repo.get(conversation_id)

    def delete_conversation(self, conversation_id: str) -> bool:
        return self._repo.delete(conversation_id)

    def clear_conversations(self) -> int:
        return self._repo.clear()

    def list_messages(self, conversation_id: str) -> list[MessageRecord]:
        return self._repo.list_messages(conversation_id)

    def add_message(
        self,
        conversation_id: str,
        role: Role,
        content: str,
        *,
        used_llm: bool = False,
        route: str | None = None,
    ) -> MessageRecord:
        return self._repo.add_message(
            conversation_id, role, content, used_llm=used_llm, route=route
        )

    def open_for_chat(self, conversation_id: str | None, title_hint: str) -> ConversationRecord:
        return self._repo.open_for_chat(conversation_id, title_hint)

    def save_exchange(
        self,
        conversation_id: str | None,
        user_text: str,
        reply_text: str,
        *,
        used_llm: bool = False,
        route: str | None = None,
        title_hint: str | None = None,
    ) -> tuple[str, MessageRecord, MessageRecord]:
        return self._repo.save_exchange(
            conversation_id,
            user_text,
            reply_text,
            used_llm=used_llm,
            route=route,
            title_hint=title_hint,
        )

    def counts(self) -> dict[str, int]:
        return self._repo.counts()
