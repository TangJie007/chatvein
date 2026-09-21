"""持久化访问（NestJS Repository 对应物）。

复用 ``db.session_scope``，不另开引擎。``tools`` / ``kb`` 在 ``service`` 层
以 JSON 文本进出，这里只负责整行读写。
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, cast

from sqlalchemy import ColumnElement, UnaryExpression
from sqlmodel import Session, col, select

from db import session_scope  # pyright: ignore[reportImplicitRelativeImport]

from .entity import Role


def _utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _col(column: object) -> ColumnElement[Any]:
    return cast("ColumnElement[Any]", column)


def _desc(column: object) -> UnaryExpression[Any]:
    return _col(column).desc()


class RoleRepository:
    """``roles`` 表的 CRUD。"""

    def find_all(self) -> list[Role]:
        statement = select(Role).order_by(
            _desc(Role.primary),
            _desc(Role.updated_at),
        )
        with session_scope() as session:
            return [self._detach(row) for row in session.exec(statement).all()]

    def find_by_id(self, role_id: str) -> Role | None:
        with session_scope() as session:
            entity = session.get(Role, role_id)
            return self._detach(entity) if entity is not None else None

    def count(self) -> int:
        with session_scope() as session:
            rows = session.exec(select(Role.id)).all()
            return len(rows)

    def create(self, entity: Role) -> Role:
        with session_scope() as session:
            session.add(entity)
            session.flush()
            session.refresh(entity)
            return self._detach(entity)

    def update(self, entity: Role) -> Role:
        payload = entity.model_dump()
        payload["updated_at"] = _utc_now()
        role_id = str(payload["id"])
        with session_scope() as session:
            existing = session.get(Role, role_id)
            if existing is None:
                raise ValueError(f"角色不存在: {role_id}")
            for key, value in payload.items():
                setattr(existing, key, value)
            session.add(existing)
            session.flush()
            session.refresh(existing)
            return self._detach(existing)

    def delete(self, role_id: str) -> bool:
        with session_scope() as session:
            entity = session.get(Role, role_id)
            if entity is None:
                return False
            session.delete(entity)
            return True

    @staticmethod
    def _detach(entity: Role) -> Role:
        """Session 关闭前拷贝字段，避免 detached 后懒加载。"""
        return Role.model_validate(entity.model_dump())
