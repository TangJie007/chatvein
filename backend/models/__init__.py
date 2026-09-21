"""LLM 模型管理模块（NestJS 风格布局）。

对应 NestJS 的 Module / Controller / Service / Entity / DTO / Repository。
路由前缀由 ``main.py`` 挂载为 ``/api/models``。

注意：本包 ``__init__`` 故意不急加载 ``module``，避免 ``db`` 注册实体时
``from models.entity import …`` 顺带拉起 repository → 再回导入 ``db`` 的循环。
"""

from typing import Any

from fastapi import APIRouter

# 只有注解、不赋值：运行时名字不存在，``__getattr__`` 仍负责懒加载。
models_router: APIRouter

__all__ = ["models_router"]


def __getattr__(name: str) -> Any:
    if name == "models_router":
        from .module import models_router as router

        if not isinstance(router, APIRouter):
            raise TypeError(f"models_router 必须是 APIRouter，实际是 {type(router).__name__}")
        return router
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
