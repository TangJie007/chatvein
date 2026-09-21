"""模块组装（NestJS Module 对应物）。

把 Controller 导出为可挂载的 ``APIRouter``；启动时由 ``main`` 调用
``on_module_init`` 做内置主角色种子导入。
"""

from fastapi import APIRouter

from .controller import roles_controller
from .service import RolesService

roles_router = APIRouter(prefix="/api/roles", tags=["roles"])
roles_router.include_router(roles_controller)

_service = RolesService()


def on_module_init() -> None:
    """模块初始化钩子：空库时写入内置主角色。"""
    seeded = _service.seed_primary_if_empty()
    if seeded is not None:
        print(
            f"CHATVEIN_ROLES seeded id={seeded.id} name={seeded.name}",
            flush=True,
        )
