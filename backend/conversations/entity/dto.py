"""会话模块 DTO / 记录类型。"""

from typing import Literal, TypedDict

from pydantic import BaseModel, Field

Role = Literal["user", "assistant", "system"]


class MessageRecord(TypedDict):
    id: int
    conversation_id: str
    role: str
    content: str
    used_llm: bool
    route: str | None
    created_at: str


class ConversationRecord(TypedDict):
    id: str
    title: str
    workspace_dir: str
    created_at: str
    updated_at: str
    message_count: int
    last_message: str | None


class CreateConversationDto(BaseModel):
    title: str = Field(default="", max_length=200)
