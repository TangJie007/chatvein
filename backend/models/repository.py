"""持久化访问（NestJS Repository 对应物）。

复用 ``db.session_scope``，不另开引擎。
"""
# pyright: reportUnknownMemberType=false, reportUnknownVariableType=false, reportUnknownArgumentType=false

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, cast

from sqlalchemy import ColumnElement, UnaryExpression, update
from sqlmodel import Session, col, select

from db import session_scope  # pyright: ignore[reportImplicitRelativeImport]

from .entity import LlmModel


def _utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _col(column: object) -> ColumnElement[Any]:
    return cast("ColumnElement[Any]", column)


def _desc(column: object) -> UnaryExpression[Any]:
    return _col(column).desc()


class LlmModelRepository:
    """``llm_models`` 表的 CRUD。"""

    def find_all(self) -> list[LlmModel]:
        statement = select(LlmModel).order_by(
            _desc(LlmModel.is_primary),
            _desc(LlmModel.is_default),
            _desc(LlmModel.updated_at),
        )
        with session_scope() as session:
            return [self._detach(row) for row in session.exec(statement).all()]

    def find_by_id(self, model_id: str) -> LlmModel | None:
        with session_scope() as session:
            entity = session.get(LlmModel, model_id)
            return self._detach(entity) if entity is not None else None

    def count(self) -> int:
        with session_scope() as session:
            rows = session.exec(select(LlmModel.id)).all()
            return len(rows)

    def create(self, entity: LlmModel) -> LlmModel:
        with session_scope() as session:
            if entity.is_default:
                self._clear_flag(session, "is_default")
            if entity.is_primary:
                self._clear_flag(session, "is_primary")
            session.add(entity)
            session.flush()
            session.refresh(entity)
            return self._detach(entity)

    def update(self, entity: LlmModel) -> LlmModel:
        payload = entity.model_dump()
        payload["updated_at"] = _utc_now()
        entity_id = str(payload["id"])
        with session_scope() as session:
            if payload.get("is_default"):
                self._clear_flag(session, "is_default", except_id=entity_id)
            if payload.get("is_primary"):
                self._clear_flag(session, "is_primary", except_id=entity_id)
            existing = session.get(LlmModel, entity_id)
            if existing is None:
                raise ValueError(f"模型不存在: {entity_id}")
            for key, value in payload.items():
                setattr(existing, key, value)
            session.add(existing)
            session.flush()
            session.refresh(existing)
            return self._detach(existing)

    def delete(self, model_id: str) -> bool:
        with session_scope() as session:
            entity = session.get(LlmModel, model_id)
            if entity is None:
                return False
            session.delete(entity)
            return True

    def set_default(self, model_id: str) -> LlmModel | None:
        with session_scope() as session:
            entity = session.get(LlmModel, model_id)
            if entity is None:
                return None
            self._clear_flag(session, "is_default")
            entity.is_default = True
            entity.updated_at = _utc_now()
            session.add(entity)
            session.flush()
            session.refresh(entity)
            return self._detach(entity)

    def find_default(self) -> LlmModel | None:
        statement = (
            select(LlmModel)
            .where(col(LlmModel.is_default) == True)  # noqa: E712
            .limit(1)
        )
        with session_scope() as session:
            entity = session.exec(statement).first()
            return self._detach(entity) if entity is not None else None

    def find_primary(self) -> LlmModel | None:
        statement = (
            select(LlmModel)
            .where(col(LlmModel.is_primary) == True)  # noqa: E712
            .limit(1)
        )
        with session_scope() as session:
            entity = session.exec(statement).first()
            return self._detach(entity) if entity is not None else None

    @staticmethod
    def _clear_flag(
        session: Session,
        flag: str,
        *,
        except_id: str | None = None,
    ) -> None:
        values = {flag: False, "updated_at": _utc_now()}
        statement = update(LlmModel).values(**values)
        if except_id is not None:
            statement = statement.where(col(LlmModel.id) != except_id)
        _ = session.execute(statement)

    @staticmethod
    def _detach(entity: LlmModel) -> LlmModel:
        """Session 关闭前拷贝字段，避免 detached 后懒加载。"""
        return LlmModel.model_validate(entity.model_dump())
