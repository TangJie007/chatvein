"""LLM 模型管理模块（NestJS 风格布局）。

对应 NestJS 的 Module / Controller / Service / Entity / DTO / Repository。
路由前缀由 ``main.py`` 挂载为 ``/api/models``。

注意：本包 ``__init__`` 故意不急加载 ``module``，避免 ``db`` 注册实体时
``from models.entity import …`` 顺带拉起 repository → 再回导入 ``db`` 的循环。
"""

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from fastapi import APIRouter

__all__ = ["models_router"]


def __getattr__(name: str) -> Any:
    if name == "models_router":
        from .module import models_router

        return models_router
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
