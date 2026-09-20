"""会话 / 消息表实体。"""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint
from sqlmodel import Field, Relationship, SQLModel

from db import utc_now  # pyright: ignore[reportImplicitRelativeImport]


class Conversation(SQLModel, table=True):
    """会话。"""

    __tablename__ = "conversations"  # pyright: ignore[reportAssignmentType]

    id: str = Field(default_factory=lambda: uuid.uuid4().hex, primary_key=True, max_length=64)
    title: str = Field(default="", max_length=200)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    messages: list["Message"] = Relationship(back_populates="conversation", cascade_delete=True)


class Message(SQLModel, table=True):
    """一条消息（user / assistant / system）。"""

    __tablename__ = "messages"  # pyright: ignore[reportAssignmentType]
    __table_args__ = (  # pyright: ignore[reportAssignmentType]
        CheckConstraint(
            "role IN ('user', 'assistant', 'system')",
            name="ck_messages_role",
        ),
    )

    id: int | None = Field(default=None, primary_key=True)
    conversation_id: str = Field(
        foreign_key="conversations.id",
        ondelete="CASCADE",
        index=True,
        max_length=64,
    )
    role: str = Field(max_length=16)
    content: str = Field()
    used_llm: bool = Field(default=False)
    route: str | None = Field(default=None, max_length=32)
    created_at: datetime = Field(default_factory=utc_now)

    conversation: Conversation | None = Relationship(back_populates="messages")
