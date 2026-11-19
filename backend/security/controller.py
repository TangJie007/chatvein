"""权限与审计的 HTTP 层（路由前缀在 ``module.py`` 里统一挂到 ``/api``）。"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from security.dto import PermissionsPayload  # pyright: ignore[reportImplicitRelativeImport]
from security.service import security_service  # pyright: ignore[reportImplicitRelativeImport]

security_controller = APIRouter()


@security_controller.get("/permissions")
def get_permissions() -> dict:
    """当前生效的规则 + 解析错误（配置坏掉时前端要能看见原因）。"""
    return security_service.permissions_view()


@security_controller.put("/permissions")
def put_permissions(payload: PermissionsPayload) -> dict:
    try:
        return security_service.save_permissions(payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@security_controller.get("/audit/events")
def list_audit_events(
    tool: str | None = None,
    action: str | None = None,
    decision: str | None = None,
    since: str | None = None,
    limit: int = Query(default=100, ge=1, le=500),
) -> dict:
    return security_service.audit_events(
        tool=tool, action=action, decision=decision, since=since, limit=limit
    )


@security_controller.get("/audit/status")
def audit_status() -> dict:
    return security_service.audit_status()
