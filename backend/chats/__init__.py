"""群组 / 团队（chats）模块：与 conversations 解耦的独立领域。

成员花名册存独立表 ``chat_groups``；团队装配收口在 ``ChatsService``。
"""

from typing import Any

__all__ = ["chats_router"]


def __getattr__(name: str) -> Any:
    if name == "chats_router":
        from .module import chats_router

        return chats_router
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
