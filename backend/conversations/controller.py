"""会话 HTTP 路由。"""

from fastapi import APIRouter, HTTPException, Body

from .entity import CreateConversationDto, UpdateConversationSkillsDto
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


@conversations_controller.put("/{conversation_id}/skills")
def update_conversation_skills(conversation_id: str, payload: UpdateConversationSkillsDto):
    """覆盖会话级技能集：Composer 勾选 / 移除时即时持久化，后续每轮对话都生效。"""
    if _service.get_conversation(conversation_id) is None:
        raise HTTPException(status_code=404, detail="会话不存在")
    skills = _service.set_conversation_skills(conversation_id, payload.skills)
    return {"conversation_id": conversation_id, "skills": skills}


@conversations_controller.post("/{conversation_id}/open-workspace")
def open_conversation_workspace(conversation_id: str):
    path = _service.open_workspace_folder(conversation_id)
    if path is None:
        raise HTTPException(status_code=404, detail="会话不存在")
    return {"ok": True, "path": path}


@conversations_controller.post("/{conversation_id}/open-artifact")
def open_artifact_location(conversation_id: str, body: dict = Body(default={})):
    """在文件管理器中打开产物所在目录（path 必须位于会话工作区内）。"""
    path = body.get("path") if isinstance(body, dict) else None
    folder = _service.open_artifact_location(conversation_id, path)
    if folder is None:
        raise HTTPException(status_code=404, detail="无法打开该路径")
    return {"ok": True, "path": folder}


@conversations_controller.get("/{conversation_id}/workspace")
def conversation_workspace(conversation_id: str):
    insight = _service.workspace_insight(conversation_id)
    if insight is None:
        raise HTTPException(status_code=404, detail="会话不存在")
    return insight


@conversations_controller.delete("/{conversation_id}/turns/last")
def delete_last_turn(
    conversation_id: str,
    user_content: str | None = None,
    after_message_id: int | None = None,
):
    """撤回 / 停止生成：删除该会话最近一轮（用户句 + 助手句）。

    ``user_content`` + ``after_message_id``：只删 baseline 之后、原文匹配的本轮，
    避免停止时误删上一轮已完成历史。
    """
    deleted = _service.delete_last_exchange(
        conversation_id,
        user_content=user_content,
        after_message_id=after_message_id,
    )
    return {"deleted": deleted}
