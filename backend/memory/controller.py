"""HTTP 路由：长期记忆管理（前缀 ``/api/memories``，由 ``main.py`` 挂载）。

路由一览：
    GET    /status              总数 / 待确认 / 过期 + 当前开关状态
    GET    /                    记忆列表（可按 status / scope 过滤）
    POST   /                    手动新增（默认直接生效）
    PATCH  /{memory_id}         改内容 / 类型 / 状态 / 置信度
    DELETE /{memory_id}         删除
    POST   /consolidate         清过期 + 合并重复（前端「整理」按钮）

聊天时的召回不经过本文件：入口是 ``main.py`` 的 ``_run_chat_heavy``
→ ``memory_service.recall_into_role``。
"""

from fastapi import APIRouter, HTTPException, Query

from memory.entity.dto import CreateMemoryDto, UpdateMemoryDto  # pyright: ignore[reportImplicitRelativeImport]
from memory.service import memory_service  # pyright: ignore[reportImplicitRelativeImport]

memory_controller = APIRouter()


@memory_controller.get("/status")
def get_status():
    return memory_service.status()


@memory_controller.get("/")
def get_memories(
    status: str | None = Query(default=None, max_length=16),
    scope: str | None = Query(default=None, max_length=16),
    limit: int = Query(default=100, ge=1, le=500),
):
    return {"memories": memory_service.list(status=status, scope=scope, limit=limit)}


@memory_controller.post("/")
def create_memory(dto: CreateMemoryDto):
    try:
        return memory_service.create(dto)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@memory_controller.patch("/{memory_id}")
def update_memory(memory_id: str, dto: UpdateMemoryDto):
    try:
        updated = memory_service.update(memory_id, dto)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if updated is None:
        raise HTTPException(status_code=404, detail="记忆不存在或已被删除")
    return updated


@memory_controller.delete("/{memory_id}")
def delete_memory(memory_id: str):
    if not memory_service.delete(memory_id):
        raise HTTPException(status_code=404, detail="记忆不存在或已被删除")
    return {"ok": True}


@memory_controller.post("/consolidate")
def consolidate():
    return memory_service.consolidate()
