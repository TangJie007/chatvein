"""会话元数据持久化（主库只存 conversations，消息在会话空间 session.sqlite）。"""
# pyright: reportUnknownMemberType=false, reportUnknownVariableType=false, reportUnknownArgumentType=false

from __future__ import annotations

import json
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


def _decode_skills(raw: str | None) -> list[str]:
    """把会话 skills 列（JSON 文本）解析为 slug 列表；损坏回退空列表。"""
    try:
        loaded = json.loads(raw or "[]")
    except (TypeError, ValueError):
        return []
    if not isinstance(loaded, list):
        return []
    return [str(item).strip() for item in loaded if str(item).strip()]


def _encode_skills(skills: list[str] | None) -> list[str]:
    """清洗 + 保序去重，供持久化使用（空串 / 空白 slug 被丢弃）。"""
    out: list[str] = []
    seen: set[str] = set()
    for raw in skills or []:
        slug = str(raw).strip()
        if not slug or slug in seen:
            continue
        seen.add(slug)
        out.append(slug)
    return out


def _conversation_dict(conversation: Conversation) -> ConversationRecord:
    return ConversationRecord(
        id=conversation.id,
        title=conversation.title,
        workspace_dir=conversation.workspace_dir,
        created_at=iso(conversation.created_at),
        updated_at=iso(conversation.updated_at),
        message_count=int(conversation.message_count or 0),
        last_message=(conversation.last_message or "").strip() or None,
        skills=_decode_skills(conversation.skills),
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

    def get_skills(self, conversation_id: str) -> list[str]:
        with session_scope() as session:
            conversation = session.get(Conversation, conversation_id)
            return _decode_skills(conversation.skills) if conversation else []

    def set_skills(self, conversation_id: str, skills: list[str] | None) -> list[str]:
        """覆盖会话级技能集合并持久化（清洗 + 保序去重）；会话不存在返回空列表。"""
        cleaned = _encode_skills(skills)
        with session_scope() as session:
            conversation = session.get(Conversation, conversation_id)
            if conversation is None:
                return []
            conversation.skills = json.dumps(cleaned, ensure_ascii=False)
            conversation.updated_at = utc_now()
            session.flush()
        return cleaned

    def set_preview(
        self,
        conversation_id: str,
        message_count: int,
        last_message: str | None,
    ) -> None:
        """写 / 删会话空间库后，把精确 preview 同步回主库冗余列。

        不触碰 ``updated_at``（排序由 ``touch_exchange`` 管）；列表 / 计数查询
        由此直接读主库，不再逐个打开 session.sqlite。
        """
        with session_scope() as session:
            conversation = session.get(Conversation, conversation_id)
            if conversation is None:
                return
            conversation.message_count = max(0, int(message_count or 0))
            conversation.last_message = (last_message or "").strip()[:2048]
            session.flush()

    def find_by_workspace(self, workspace_dir: str) -> ConversationRecord | None:
        """按工作区目录名反查会话（delegate 派发写回空间库时同步主库预览）。"""
        name = (workspace_dir or "").strip()
        if not name:
            return None
        with session_scope() as session:
            conversation = session.exec(
                select(Conversation).where(Conversation.workspace_dir == name)
            ).first()
            return _conversation_dict(conversation) if conversation is not None else None

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
        """会话 / 消息计数。消息数来自主库冗余列（SUM），不再逐个打开会话空间库。"""

        def _read(s: Session) -> dict[str, int]:
            conversations = s.scalar(select(func.count()).select_from(Conversation)) or 0
            messages = (
                s.scalar(select(func.coalesce(func.sum(Conversation.message_count), 0))) or 0
            )
            return {"conversations": int(conversations), "messages": int(messages)}

        if session is not None:
            return _read(session)
        with session_scope() as s:
            return _read(s)
