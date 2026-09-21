"""roles.entity 子包：表实体 + DTO（NestJS Entity / DTO）。"""

from .dto import CreateRoleDto, RoleResponseDto, UpdateRoleDto
from .entity import Role

__all__ = [
    "Role",
    "CreateRoleDto",
    "UpdateRoleDto",
    "RoleResponseDto",
]
