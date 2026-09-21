"""HTTP 路由（NestJS Controller 对应物）。"""

from fastapi import APIRouter, HTTPException

from .entity import CreateRoleDto, UpdateRoleDto
from .service import RolesService

roles_controller = APIRouter()
_service = RolesService()


@roles_controller.get("/")
def list_roles():
    return {"roles": _service.list_roles()}


@roles_controller.get("/{role_id}")
def get_role(role_id: str):
    role = _service.get_role(role_id)
    if role is None:
        raise HTTPException(status_code=404, detail="角色不存在")
    return role


@roles_controller.post("/", status_code=201)
def create_role(payload: CreateRoleDto):
    return _service.create_role(payload)


@roles_controller.patch("/{role_id}")
def update_role(role_id: str, payload: UpdateRoleDto):
    role = _service.update_role(role_id, payload)
    if role is None:
        raise HTTPException(status_code=404, detail="角色不存在")
    return role


@roles_controller.delete("/{role_id}")
def delete_role(role_id: str):
    try:
        deleted = _service.delete_role(role_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="角色不存在")
    return {"deleted": 1, "id": role_id}
