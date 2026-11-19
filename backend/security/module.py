"""模块组装：``/api/permissions`` 与 ``/api/audit/*`` 一并挂载，供 main.py include。"""

from fastapi import APIRouter

from security.controller import security_controller  # pyright: ignore[reportImplicitRelativeImport]
from security.service import security_service  # pyright: ignore[reportImplicitRelativeImport]

security_router = APIRouter(prefix="/api", tags=["security"])
security_router.include_router(security_controller)

__all__ = ["security_router", "security_service"]
