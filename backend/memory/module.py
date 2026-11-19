"""模块组装：把 controller 挂成 ``/api/memories`` 前缀路由，供 main.py include。"""

from fastapi import APIRouter

from memory.controller import memory_controller  # pyright: ignore[reportImplicitRelativeImport]
from memory.service import memory_service  # pyright: ignore[reportImplicitRelativeImport]

memory_router = APIRouter(prefix="/api/memories", tags=["memory"])
memory_router.include_router(memory_controller)

__all__ = ["memory_router", "memory_service"]
