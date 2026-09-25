"""模块组装：把 controller 挂成 ``/api/chats`` 前缀路由，供 main.py include。

    chats_router = APIRouter(prefix="/api/chats", tags=["chats"])
    chats_router.include_router(chats_controller)
"""

from fastapi import APIRouter

from .controller import chats_controller
from .service import ChatsService

chats_router = APIRouter(prefix="/api/chats", tags=["chats"])
chats_router.include_router(chats_controller)

#: 全局单例：main.py 随消息透传群组注册、团队装配统一走它。
chats_service = ChatsService()
