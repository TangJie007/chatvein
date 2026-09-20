"""业务逻辑（NestJS Service 对应物）。"""

from __future__ import annotations

import os
from datetime import datetime, timezone

from .entity import (
    CreateLlmModelDto,
    LlmModel,
    LlmModelResponseDto,
    UpdateLlmModelDto,
)
from .repository import LlmModelRepository


def _utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _iso(value: datetime) -> str:
    aware = value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value
    return aware.astimezone(timezone.utc).isoformat(timespec="seconds")


def mask_api_key(api_key: str | None) -> str | None:
    if not api_key:
        return None
    if len(api_key) <= 8:
        return "****" + api_key[-2:]
    return api_key[:6] + "************" + api_key[-4:]


class ModelsService:
    def __init__(self, repository: LlmModelRepository | None = None) -> None:
        self._repo = repository or LlmModelRepository()

    def to_response(self, entity: LlmModel) -> LlmModelResponseDto:
        return LlmModelResponseDto(
            id=entity.id,
            name=entity.name,
            provider=entity.provider,
            model_id=entity.model_id,
            base_url=entity.base_url,
            key_mask=mask_api_key(entity.api_key),
            has_api_key=bool(entity.api_key),
            temperature=entity.temperature,
            max_tokens=entity.max_tokens,
            presence_penalty=entity.presence_penalty,
            frequency_penalty=entity.frequency_penalty,
            stream=entity.stream,
            json_mode=entity.json_mode,
            retries=entity.retries,
            context_window_k=entity.context_window_k,
            is_default=entity.is_default,
            is_primary=entity.is_primary,
            enabled=entity.enabled,
            description=entity.description,
            created_at=_iso(entity.created_at),
            updated_at=_iso(entity.updated_at),
        )

    def list_models(self) -> list[LlmModelResponseDto]:
        return [self.to_response(m) for m in self._repo.find_all()]

    def count(self) -> int:
        return self._repo.count()

    def get_model(self, model_id: str) -> LlmModelResponseDto | None:
        entity = self._repo.find_by_id(model_id)
        return self.to_response(entity) if entity else None

    def create_model(self, dto: CreateLlmModelDto) -> LlmModelResponseDto:
        now = _utc_now()
        entity = LlmModel(
            name=dto.name.strip(),
            provider=dto.provider.strip() or "openai",
            model_id=dto.model_id.strip(),
            base_url=(dto.base_url or "").strip() or None,
            api_key=(dto.api_key or "").strip() or None,
            temperature=dto.temperature,
            max_tokens=dto.max_tokens,
            presence_penalty=dto.presence_penalty,
            frequency_penalty=dto.frequency_penalty,
            stream=dto.stream,
            json_mode=dto.json_mode,
            retries=dto.retries,
            context_window_k=dto.context_window_k,
            is_default=dto.is_default,
            is_primary=dto.is_primary,
            enabled=dto.enabled,
            description=dto.description.strip(),
            created_at=now,
            updated_at=now,
        )
        # 首条自动设为默认 + 主模型
        if self._repo.count() == 0:
            entity.is_default = True
            entity.is_primary = True
        saved = self._repo.create(entity)
        return self.to_response(saved)

    def update_model(
        self, model_id: str, dto: UpdateLlmModelDto
    ) -> LlmModelResponseDto | None:
        entity = self._repo.find_by_id(model_id)
        if entity is None:
            return None

        data = dto.model_dump(exclude_unset=True)
        if "api_key" in data:
            raw = data["api_key"]
            # 空串清空；前端若回传脱敏串则忽略，避免把 mask 当密钥写入
            if raw is None or raw == "":
                entity.api_key = None
            elif "*" in raw or "•" in raw or raw == entity.api_key:
                pass
            else:
                entity.api_key = raw.strip() or None
            del data["api_key"]

        for key, value in data.items():
            if key in {"name", "provider", "model_id", "description"} and isinstance(
                value, str
            ):
                value = value.strip()
            if key == "base_url" and isinstance(value, str):
                value = value.strip() or None
            setattr(entity, key, value)

        saved = self._repo.update(entity)
        return self.to_response(saved)

    def delete_model(self, model_id: str) -> bool:
        return self._repo.delete(model_id)

    def set_default(self, model_id: str) -> LlmModelResponseDto | None:
        entity = self._repo.set_default(model_id)
        return self.to_response(entity) if entity else None

    def get_runtime_config(self) -> LlmModel | None:
        """供 graph / chat 使用：优先主模型，其次默认，再取列表第一条。"""
        return (
            self._repo.find_primary()
            or self._repo.find_default()
            or (self._repo.find_all()[:1] or [None])[0]
        )

    def seed_from_env_if_empty(self) -> LlmModelResponseDto | None:
        """库为空且环境有 OPENAI_API_KEY 时，写入一条默认配置。"""
        if self._repo.count() > 0:
            return None
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            return None
        dto = CreateLlmModelDto(
            name="默认对话模型",
            provider="openai",
            model_id=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
            base_url=os.getenv("OPENAI_BASE_URL") or None,
            api_key=api_key,
            is_default=True,
            is_primary=True,
            description="由环境变量 OPENAI_* 自动导入",
        )
        return self.create_model(dto)
