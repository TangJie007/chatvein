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


@conversations_controller.post("/{conversation_id}/open-workspace")
def open_conversation_workspace(conversation_id: str):
    path = _service.open_workspace_folder(conversation_id)
    if path is None:
        raise HTTPException(status_code=404, detail="会话不存在")
    return {"ok": True, "path": path}


@conversations_controller.get("/{conversation_id}/workspace")
def conversation_workspace(conversation_id: str):
    insight = _service.workspace_insight(conversation_id)
    if insight is None:
        raise HTTPException(status_code=404, detail="会话不存在")
    return insight


@conversations_controller.get("/{conversation_id}/traces")
def list_traces(conversation_id: str):
    traces = _service.list_traces(conversation_id)
    if traces is None:
        raise HTTPException(status_code=404, detail="会话不存在")
    return {"traces": traces}


@conversations_controller.get("/{conversation_id}/traces/{turn_id}")
def get_trace(conversation_id: str, turn_id: str):
    trace = _service.get_trace(conversation_id, turn_id)
    if trace is None:
        raise HTTPException(status_code=404, detail="没有这一轮的追踪")
    return trace
