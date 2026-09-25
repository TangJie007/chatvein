"""chats 群组成员持久化：独立的 ``chat_groups`` 表（主库）。

只读写 ``chat_groups`` 一张表，与会话元数据 / 消息存储完全解耦。
"""

from __future__ import annotations

import json

from db import session_scope, utc_now  # pyright: ignore[reportImplicitRelativeImport]

from .entity import ChatGroup


def _decode_members(raw: str | None) -> list[str]:
    """把 ``chat_groups.members`` 列（JSON 文本）解析为角色 id 列表；损坏回退空列表。"""
    try:
        loaded = json.loads(raw or "[]")
    except (TypeError, ValueError):
        return []
    if not isinstance(loaded, list):
        return []
    return [str(item).strip() for item in loaded if str(item).strip()]


def _encode_members(members: list[str] | None) -> list[str]:
    """清洗 + 保序去重群组成员（空串 / 重复 id 被丢弃）。"""
    out: list[str] = []
    seen: set[str] = set()
    for raw in members or []:
        mid = str(raw).strip()
        if not mid or mid in seen:
            continue
        seen.add(mid)
        out.append(mid)
    return out


class ChatGroupsRepository:
    """``chat_groups`` 表的数据访问层。"""

    def get_members(self, conversation_id: str) -> list[str]:
        """读取会话群组成员（角色 id 列表）；未注册返回空列表。"""
        with session_scope() as session:
            row: ChatGroup | None = session.get(ChatGroup, conversation_id)
            return _decode_members(row.members) if row else []

    def merge_members(self, conversation_id: str, members: list[str] | None) -> list[str]:
        """补注册群组成员：与现有成员合并去重后持久化，返回最新列表。"""
        now = utc_now()
        with session_scope() as session:
            row: ChatGroup | None = session.get(ChatGroup, conversation_id)
            if row is None:
                row = ChatGroup(
                    conversation_id=conversation_id,
                    members=json.dumps(_encode_members(members), ensure_ascii=False),
                    created_at=now,
                    updated_at=now,
                )
                session.add(row)
            else:
                merged = _encode_members(_decode_members(row.members) + list(members or []))
                row.members = json.dumps(merged, ensure_ascii=False)
                row.updated_at = now
            session.flush()
            return _decode_members(row.members)


__all__ = ["ChatGroup", "ChatGroupsRepository", "_decode_members", "_encode_members"]
