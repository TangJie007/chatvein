"""会话 / 消息模块（NestJS 风格）。"""

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from fastapi import APIRouter

__all__ = ["conversations_router"]


def __getattr__(name: str) -> Any:
    if name == "conversations_router":
        from .module import conversations_router

        return conversations_router
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
