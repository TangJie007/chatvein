"""知识库管理模块（NestJS Module 对应物）：对外暴露 knowledge_router。"""

from fastapi import APIRouter

from .controller import knowledge_controller

knowledge_router = APIRouter(prefix="/api/kb", tags=["knowledge"])
knowledge_router.include_router(knowledge_controller)
