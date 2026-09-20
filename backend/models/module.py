"""模块组装（NestJS Module 对应物）。

把 Controller 导出为可挂载的 ``APIRouter``；启动时由 ``main`` 调用
``on_module_init`` 做环境种子导入。
"""

from fastapi import APIRouter

from .controller import models_controller
from .service import ModelsService

models_router = APIRouter(prefix="/api/models", tags=["models"])
models_router.include_router(models_controller)

_service = ModelsService()


def on_module_init() -> None:
    """模块初始化钩子：空库时尝试从 OPENAI_* 环境导入一条模型。"""
    seeded = _service.seed_from_env_if_empty()
    if seeded is not None:
        print(
            f"CHATVEIN_MODELS seeded id={seeded.id} model={seeded.model_id}",
            flush=True,
        )
