"""会话 HTTP 路由。"""

from fastapi import APIRouter, HTTPException

from .entity import CreateConversationDto
from .service import ConversationsService

conversations_controller = APIRouter()
_service = ConversationsService()


@conversations_controller.get("/")
def list_conversations(limit: int = 50):
    return {"conversations": _service.list_conversations(limit)}


@conversations_controller.post("/", status_code=201)
def create_conversation(payload: CreateConversationDto):
    return _service.create_conversation(payload)


@conversations_controller.delete("/")
def clear_conversations():
    return {"deleted": _service.clear_conversations()}


@conversations_controller.get("/{conversation_id}")
def get_conversation(conversation_id: str):
    conversation = _service.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="会话不存在")
    return {
        "conversation": conversation,
        "messages": _service.list_messages(conversation_id),
    }


@conversations_controller.delete("/{conversation_id}")
def delete_conversation(conversation_id: str):
    if not _service.delete_conversation(conversation_id):
        raise HTTPException(status_code=404, detail="会话不存在")
    return {"deleted": 1, "id": conversation_id}


@conversations_controller.get("/{conversation_id}/messages")
def list_messages(conversation_id: str):
    return {"messages": _service.list_messages(conversation_id)}


@conversations_controller.get("/{conversation_id}/workspace")
def conversation_workspace(conversation_id: str):
    insight = _service.workspace_insight(conversation_id)
    if insight is None:
        raise HTTPException(status_code=404, detail="会话不存在")
    return insight
