"""会话元数据持久化（主库只存 conversations，消息在会话空间 session.sqlite）。"""
# pyright: reportUnknownMemberType=false, reportUnknownVariableType=false, reportUnknownArgumentType=false

from __future__ import annotations

from typing import Any, cast

from sqlalchemy import ColumnElement, UnaryExpression, delete, func
from sqlmodel import Session, select

from db import iso, session_scope, utc_now  # pyright: ignore[reportImplicitRelativeImport]
from mcps.sandbox import (  # pyright: ignore[reportImplicitRelativeImport]
    conversation_root,
    create_conversation_dir,
    init_conversation_layout,
    remove_conversation_dir,
)

from .entity import Conversation, ConversationRecord

TITLE_MAX_LEN = 30


def _col(column: object) -> ColumnElement[Any]:
    return cast("ColumnElement[Any]", column)


def _desc(column: object) -> UnaryExpression[Any]:
    return _col(column).desc()


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
        statement = (
            select(Conversation)
            .order_by(_desc(Conversation.updated_at))
            .limit(limit)
        )
        with session_scope() as session:
            rows = session.exec(statement).all()
            return [_conversation_dict(conversation) for conversation in rows]

    def get(self, conversation_id: str) -> ConversationRecord | None:
        with session_scope() as session:
            conversation = session.get(Conversation, conversation_id)
            if conversation is None:
                return None
            return _conversation_dict(conversation)

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

    def touch_exchange(
        self,
        conversation_id: str | None,
        *,
        title_hint: str,
    ) -> ConversationRecord:
        """一轮对话结束后更新标题与 updated_at（消息写在会话空间库）。"""
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
                if not conversation.title:
                    conversation.title = hint
                conversation.updated_at = now
            session.flush()
            return _conversation_dict(conversation)

    def counts(self, session: Session | None = None) -> dict[str, int]:
        def _read(s: Session) -> dict[str, int]:
            conversations = s.scalar(select(func.count()).select_from(Conversation)) or 0
            return {"conversations": int(conversations), "messages": 0}

        if session is not None:
            return _read(session)
        with session_scope() as s:
            return _read(s)
