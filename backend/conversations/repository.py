"""会话 / 消息持久化。"""
# pyright: reportUnknownMemberType=false, reportUnknownVariableType=false, reportUnknownArgumentType=false

from __future__ import annotations

from typing import Any, cast

from sqlalchemy import ColumnElement, UnaryExpression, delete, func
from sqlmodel import Session, select
from sqlmodel.sql.expression import Select

from db import iso, session_scope, utc_now  # pyright: ignore[reportImplicitRelativeImport]
from mcps.sandbox import (  # pyright: ignore[reportImplicitRelativeImport]
    conversation_root,
    create_conversation_dir,
    init_conversation_layout,
    remove_conversation_dir,
)

from .entity import Conversation, ConversationRecord, Message, MessageRecord, Role

TITLE_MAX_LEN = 30


def _col(column: object) -> ColumnElement[Any]:
    return cast("ColumnElement[Any]", column)


def _desc(column: object) -> UnaryExpression[Any]:
    return _col(column).desc()


def _message_dict(message: Message) -> MessageRecord:
    return MessageRecord(
        id=int(message.id or 0),
        conversation_id=message.conversation_id,
        role=message.role,
        content=message.content,
        used_llm=message.used_llm,
        route=message.route,
        created_at=iso(message.created_at),
        turn_id=message.turn_id,
    )


def _conversation_dict(
    conversation: Conversation,
    message_count: int = 0,
    last_message: str | None = None,
) -> ConversationRecord:
    return ConversationRecord(
        id=conversation.id,
        title=conversation.title,
        workspace_dir=conversation.workspace_dir,
        created_at=iso(conversation.created_at),
        updated_at=iso(conversation.updated_at),
        message_count=message_count,
        last_message=last_message,
    )


def _derive_title(value: str) -> str:
    title = " ".join(value.strip().split())
    if len(title) > TITLE_MAX_LEN:
        return title[:TITLE_MAX_LEN] + "…"
    return title or "新会话"


def _ensure_workspace(conversation: Conversation) -> None:
    """保证会话目录已分配、布局齐全。旧数据或非法名称会重新分配。"""
    name = (conversation.workspace_dir or "").strip()
    if name:
        try:
            init_conversation_layout(conversation_root(name))
            return
        except ValueError:
            pass
    conversation.workspace_dir = create_conversation_dir()


class ConversationsRepository:
    def _list_statement(self, limit: int | None = None) -> Select[Any]:
        last_message = (
            select(_col(Message.content))
            .where(_col(Message.conversation_id) == _col(Conversation.id))
            .order_by(_desc(Message.id))
            .limit(1)
            .correlate(Conversation)
            .scalar_subquery()
        )
        statement = (
            select(Conversation, func.count(_col(Message.id)), last_message)
            .outerjoin(Message, _col(Message.conversation_id) == _col(Conversation.id))
            .group_by(_col(Conversation.id))
            .order_by(_desc(Conversation.updated_at))
        )
        return statement.limit(limit) if limit is not None else statement

    def create(self, title: str = "") -> ConversationRecord:
        with session_scope() as session:
            conversation = Conversation(
                title=title.strip(),
                workspace_dir=create_conversation_dir(),
            )
            session.add(conversation)
            session.flush()
            return _conversation_dict(conversation)

    def list(self, limit: int = 50) -> list[ConversationRecord]:
        with session_scope() as session:
            rows = session.exec(self._list_statement(limit)).all()
            return [
                _conversation_dict(conversation, count, last)
                for conversation, count, last in rows
            ]

    def get(self, conversation_id: str) -> ConversationRecord | None:
        with session_scope() as session:
            rows = session.exec(
                self._list_statement().where(_col(Conversation.id) == conversation_id)
            ).all()
            if not rows:
                return None
            conversation, count, last = rows[0]
            return _conversation_dict(conversation, count, last)

    def delete(self, conversation_id: str) -> bool:
        name = ""
        with session_scope() as session:
            conversation = session.get(Conversation, conversation_id)
            if conversation is None:
                return False
            name = conversation.workspace_dir
            session.delete(conversation)
        remove_conversation_dir(name)
        return True

    def clear(self) -> int:
        names: list[str] = []
        with session_scope() as session:
            names = [
                conversation.workspace_dir
                for conversation in session.exec(select(Conversation)).all()
                if conversation.workspace_dir
            ]
            deleted = session.scalar(select(func.count()).select_from(Conversation)) or 0
            session.exec(delete(Message).execution_options(synchronize_session=False)).close()
            session.exec(
                delete(Conversation).execution_options(synchronize_session=False)
            ).close()
            removed = int(deleted)
        for name in names:
            remove_conversation_dir(name)
        return removed

    def open_for_chat(self, conversation_id: str | None, title_hint: str) -> ConversationRecord:
        """聊天开始前确保会话和它的工作区目录都存在。未知 id 会新建。"""
        hint = _derive_title(title_hint)
        now = utc_now()
        with session_scope() as session:
            conversation = (
                session.get(Conversation, conversation_id) if conversation_id else None
            )
            if conversation is None:
                conversation = Conversation(
                    title=hint,
                    workspace_dir=create_conversation_dir(),
                    created_at=now,
                    updated_at=now,
                )
                session.add(conversation)
            else:
                _ensure_workspace(conversation)
            session.flush()
            return _conversation_dict(conversation)

    def add_message(
        self,
        conversation_id: str,
        role: Role,
        content: str,
        *,
        used_llm: bool = False,
        route: str | None = None,
    ) -> MessageRecord:
        now = utc_now()
        with session_scope() as session:
            conversation = session.get(Conversation, conversation_id)
            if conversation is None:
                raise ValueError(f"会话不存在: {conversation_id}")
            message = Message(
                conversation_id=conversation_id,
                role=role,
                content=content,
                used_llm=used_llm,
                route=route,
                created_at=now,
            )
            session.add(message)
            conversation.updated_at = now
            session.flush()
            return _message_dict(message)

    def list_messages(self, conversation_id: str, limit: int = 200) -> list[MessageRecord]:
        statement = (
            select(Message)
            .where(_col(Message.conversation_id) == conversation_id)
            .order_by(_col(Message.id))
            .limit(limit)
        )
        with session_scope() as session:
            return [_message_dict(m) for m in session.exec(statement).all()]

    def save_exchange(
        self,
        conversation_id: str | None,
        user_text: str,
        reply_text: str,
        *,
        used_llm: bool = False,
        route: str | None = None,
        title_hint: str | None = None,
        turn_id: str | None = None,
    ) -> tuple[str, MessageRecord, MessageRecord]:
        now = utc_now()
        hint = _derive_title(title_hint or user_text)
        with session_scope() as session:
            conversation = (
                session.get(Conversation, conversation_id) if conversation_id else None
            )
            if conversation is None:
                conversation = Conversation(
                    title=hint,
                    workspace_dir=create_conversation_dir(),
                    created_at=now,
                    updated_at=now,
                )
                session.add(conversation)
            else:
                _ensure_workspace(conversation)
                if not conversation.title:
                    conversation.title = hint

            user_message = Message(
                conversation_id=conversation.id,
                role="user",
                content=user_text,
                route=route,
                created_at=now,
            )
            assistant_message = Message(
                conversation_id=conversation.id,
                role="assistant",
                content=reply_text,
                used_llm=used_llm,
                route=route,
                turn_id=turn_id or "",
                created_at=now,
            )
            session.add(user_message)
            session.add(assistant_message)
            conversation.updated_at = now
            session.flush()
            return (
                conversation.id,
                _message_dict(user_message),
                _message_dict(assistant_message),
            )

    def counts(self, session: Session | None = None) -> dict[str, int]:
        def _read(s: Session) -> dict[str, int]:
            conversations = s.scalar(select(func.count()).select_from(Conversation)) or 0
            messages = s.scalar(select(func.count()).select_from(Message)) or 0
            return {"conversations": int(conversations), "messages": int(messages)}

        if session is not None:
            return _read(session)
        with session_scope() as s:
            return _read(s)
