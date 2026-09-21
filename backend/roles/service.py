"""业务逻辑（NestJS Service 对应物）。"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

from .entity import CreateRoleDto, Role, RoleResponseDto, UpdateRoleDto
from .repository import RoleRepository


def _utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _iso(value: datetime) -> str:
    aware = value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value
    return aware.astimezone(timezone.utc).isoformat(timespec="seconds")


def _decode_list(raw: Any) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, list):
        return [str(x) for x in raw]
    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, TypeError, ValueError):
        return []
    return [str(x) for x in parsed] if isinstance(parsed, list) else []


def _encode_list(items: Any) -> str:
    if not items:
        return "[]"
    return json.dumps([str(x) for x in items], ensure_ascii=False)


def _new_id() -> str:
    return f"role-{uuid.uuid4().hex[:12]}"


class RolesService:
    def __init__(self, repository: RoleRepository | None = None) -> None:
        self._repo = repository or RoleRepository()

    # ---- 响应构造 ----

    def to_response(self, entity: Role) -> RoleResponseDto:
        return RoleResponseDto(
            id=entity.id,
            name=entity.name,
            initial=entity.initial,
            prompt=entity.prompt,
            model_id=entity.model_id,
            tone=entity.tone,
            temperature=entity.temperature,
            max_tokens=entity.max_tokens,
            presence_penalty=entity.presence_penalty,
            frequency_penalty=entity.frequency_penalty,
            stream=entity.stream,
            json_mode=entity.json_mode,
            retries=entity.retries,
            memory=entity.memory,
            enabled=entity.enabled,
            tools=_decode_list(entity.tools),
            kb=_decode_list(entity.kb),
            sessions=entity.sessions,
            primary=entity.primary,
            created_at=_iso(entity.created_at),
            updated_at=_iso(entity.updated_at),
        )

    # ---- 查询 ----

    def list_roles(self) -> list[RoleResponseDto]:
        return [self.to_response(r) for r in self._repo.find_all()]

    def get_role(self, role_id: str) -> RoleResponseDto | None:
        entity = self._repo.find_by_id(role_id)
        return self.to_response(entity) if entity else None

    # ---- 写入 ----

    def create_role(self, dto: CreateRoleDto) -> RoleResponseDto:
        now = _utc_now()
        name = (dto.name or "新角色").strip() or "新角色"
        initial = (dto.initial or name[:1] or "角").strip()[:1] or "角"
        entity = Role(
            id=_new_id(),
            name=name,
            initial=initial,
            prompt=dto.prompt or "",
            model_id=(dto.model_id or "").strip(),
            tone=(dto.tone or "brand").strip() or "brand",
            temperature=dto.temperature if dto.temperature is not None else 0.7,
            max_tokens=dto.max_tokens if dto.max_tokens is not None else 4096,
            presence_penalty=dto.presence_penalty if dto.presence_penalty is not None else 0.0,
            frequency_penalty=dto.frequency_penalty if dto.frequency_penalty is not None else 0.0,
            stream=dto.stream if dto.stream is not None else True,
            json_mode=dto.json_mode if dto.json_mode is not None else False,
            retries=dto.retries if dto.retries is not None else 2,
            memory=dto.memory if dto.memory is not None else 8,
            enabled=dto.enabled if dto.enabled is not None else True,
            tools=_encode_list(dto.tools),
            kb=_encode_list(dto.kb),
            sessions=0,
            primary=bool(dto.primary) if dto.primary is not None else False,
            created_at=now,
            updated_at=now,
        )
        saved = self._repo.create(entity)
        return self.to_response(saved)

    def update_role(
        self, role_id: str, dto: UpdateRoleDto
    ) -> RoleResponseDto | None:
        entity = self._repo.find_by_id(role_id)
        if entity is None:
            return None

        data = dto.model_dump(exclude_unset=True)
        if not data:
            return self.to_response(entity)

        if data.get("name") is not None:
            entity.name = str(data["name"]).strip() or entity.name
        if data.get("initial") is not None:
            entity.initial = (str(data["initial"]).strip()[:1]) or entity.initial

        scalars = (
            "prompt",
            "model_id",
            "tone",
            "temperature",
            "max_tokens",
            "presence_penalty",
            "frequency_penalty",
            "stream",
            "json_mode",
            "retries",
            "memory",
            "enabled",
            "primary",
            "sessions",
        )
        for field in scalars:
            if field in data and data[field] is not None:
                value = data[field]
                if field in {"model_id", "tone", "prompt"}:
                    value = str(value)
                setattr(entity, field, value)

        if data.get("tools") is not None:
            entity.tools = _encode_list(data["tools"])
        if data.get("kb") is not None:
            entity.kb = _encode_list(data["kb"])

        entity.updated_at = _utc_now()
        saved = self._repo.update(entity)
        return self.to_response(saved)

    def delete_role(self, role_id: str) -> bool:
        entity = self._repo.find_by_id(role_id)
        if entity is None:
            return False
        if entity.primary:
            raise ValueError("内置主角色不可删除")
        return self._repo.delete(role_id)

    # ---- 聊天运行时 ----

    def resolve_for_chat(self, role_id: str | None) -> dict[str, Any] | None:
        """聊天默认用主对话角色；显式传入且存在的 id 优先。"""
        wanted = (role_id or "").strip()
        if wanted:
            runtime = self.get_runtime(wanted)
            if runtime is not None:
                return runtime
        rows = self._repo.find_all()
        chosen = next((row for row in rows if row.primary), None)
        if chosen is None and rows:
            chosen = rows[0]
        if chosen is None:
            return None
        return self.get_runtime(chosen.id)

    def get_runtime(self, role_id: str) -> dict[str, Any] | None:
        """供 ``/api/chat`` 使用：角色解析后的模型与生成参数。"""
        entity = self._repo.find_by_id(role_id)
        if entity is None:
            return None
        return {
            "id": entity.id,
            "name": entity.name,
            "prompt": entity.prompt,
            "model_id": entity.model_id,
            "temperature": entity.temperature,
            "max_tokens": entity.max_tokens,
            "presence_penalty": entity.presence_penalty,
            "frequency_penalty": entity.frequency_penalty,
            "stream": entity.stream,
            "json_mode": entity.json_mode,
            "retries": entity.retries,
            "memory": entity.memory,
            "tools": _decode_list(entity.tools),
            "primary": entity.primary,
        }

    # ---- 种子 ----

    def seed_primary_if_empty(self) -> RoleResponseDto | None:
        """库为空时写入内置主角色（与前端历史种子对齐）。"""
        if self._repo.count() > 0:
            return None
        dto = CreateRoleDto(
            name="主对话角色",
            initial="主",
            prompt=(
                "你是 ChatVein 的主对话助手，擅长日常问答、写作与资料整理。\n"
                "保持简洁、友好、专业，必要时给出结构化建议。"
            ),
            model_id="",
            tone="brand",
            primary=True,
        )
        return self.create_role(dto)
