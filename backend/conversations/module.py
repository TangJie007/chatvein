"""会话模块组装。"""

from fastapi import APIRouter

from .controller import conversations_controller
from .service import ConversationsService

conversations_router = APIRouter(prefix="/api/conversations", tags=["conversations"])
conversations_router.include_router(conversations_controller)

conversations_service = ConversationsService()
