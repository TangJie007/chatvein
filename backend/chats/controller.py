"""chats HTTP 路由（群组成员管理，前缀 /api/chats）。"""

from fastapi import APIRouter, HTTPException

from conversations.service import ConversationsService  # pyright: ignore[reportImplicitRelativeImport]

from .entity import GroupMembersDto
from .service import ChatsService

chats_controller = APIRouter()
_service = ChatsService()
_conversations = ConversationsService()


def _require_conversation(conversation_id: str) -> None:
    """会话不存在时 404（chats 对 conversations 仅做存在性查询，单向依赖）。"""
    if _conversations.get_conversation(conversation_id) is None:
        raise HTTPException(status_code=404, detail="会话不存在")


@chats_controller.get("/{conversation_id}/group-members")
def get_group_members(conversation_id: str):
    """读取会话群组成员（角色 id 列表）。"""
    _require_conversation(conversation_id)
    return {
        "conversation_id": conversation_id,
        "group_members": _service.get_group_members(conversation_id),
    }


@chats_controller.post("/{conversation_id}/group-members")
def register_group_members(conversation_id: str, payload: GroupMembersDto):
    """补注册群组成员：与现有成员合并去重后持久化（也可随 /api/chat 消息透传）。"""
    _require_conversation(conversation_id)
    members = _service.register_group_members(conversation_id, payload.group_members)
    return {"conversation_id": conversation_id, "group_members": members}
