"""业务逻辑（NestJS Service 对应物）。

不再区分「主模型 / 默认模型」：
- 新增模型不会自动打任何特殊标签；
- 不存在 ``get_runtime_config`` 回退链，聊天路径必须通过角色绑定模型；
- ``/default`` 端点已从 controller 移除。
"""

from __future__ import annotations

import os
import time
from datetime import datetime, timezone
from typing import Any

import httpx

from .crypto import decrypt_secret, encrypt_secret
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
            key_mask=mask_api_key(decrypt_secret(entity.api_key)),
            has_api_key=bool(entity.api_key),
            temperature=entity.temperature,
            max_tokens=entity.max_tokens,
            presence_penalty=entity.presence_penalty,
            frequency_penalty=entity.frequency_penalty,
            stream=entity.stream,
            json_mode=entity.json_mode,
            retries=entity.retries,
            context_window_k=entity.context_window_k,
            enabled=entity.enabled,
            fallback_config_id=entity.fallback_config_id,
            price_input=entity.price_input,
            price_output=entity.price_output,
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

    def _validate_fallback(
        self, model_id: str | None, fallback_id: str | None
    ) -> str | None:
        """备用模型只能是「另一条存在且已启用」的配置。

        死链会在运行期被 `agents/llm.py` 静默忽略，用户会以为已经配好；所以在写入时
        就报错，错误文案直接给出下一步。
        """
        if not fallback_id:
            return None
        fallback_id = fallback_id.strip()
        if model_id and fallback_id == model_id:
            raise ValueError("备用模型不能指向自己")
        target = self._repo.find_by_id(fallback_id)
        if target is None:
            raise ValueError("备用模型不存在，请先在模型列表里创建它")
        if not target.enabled:
            raise ValueError("备用模型已停用，请先启用它再设为备用")
        return fallback_id

    def create_model(self, dto: CreateLlmModelDto) -> LlmModelResponseDto:
        now = _utc_now()
        entity = LlmModel(
            name=dto.name.strip(),
            provider=dto.provider.strip() or "openai",
            model_id=dto.model_id.strip(),
            base_url=(dto.base_url or "").strip() or None,
            api_key=encrypt_secret((dto.api_key or "").strip() or None),
            temperature=dto.temperature,
            max_tokens=dto.max_tokens,
            presence_penalty=dto.presence_penalty,
            frequency_penalty=dto.frequency_penalty,
            stream=dto.stream,
            json_mode=dto.json_mode,
            retries=dto.retries,
            context_window_k=dto.context_window_k,
            enabled=dto.enabled,
            fallback_config_id=self._validate_fallback(None, dto.fallback_config_id),
            price_input=dto.price_input,
            price_output=dto.price_output,
            description=dto.description.strip(),
            created_at=now,
            updated_at=now,
        )
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
                entity.api_key = encrypt_secret(raw.strip() or None)
            del data["api_key"]

        if "fallback_config_id" in data:
            data["fallback_config_id"] = self._validate_fallback(
                model_id, data["fallback_config_id"]
            )

        for key, value in data.items():
            if isinstance(value, str) and key in {
                "name",
                "provider",
                "model_id",
                "description",
            }:
                value = value.strip()
            # 空串表示清除：备用模型 / 基地址都要落成 NULL，而不是空字符串
            if key in {"fallback_config_id", "base_url"} and isinstance(value, str):
                value = value.strip() or None
            setattr(entity, key, value)

        saved = self._repo.update(entity)
        return self.to_response(saved)

    def delete_model(self, model_id: str) -> bool:
        return self._repo.delete(model_id)

    def test_connection(self, model_id: str) -> dict[str, Any] | None:
        """探测 OpenAI 兼容 ``GET {base_url}/models``。"""
        entity = self._repo.find_by_id(model_id)
        if entity is None:
            return None

        base = (entity.base_url or "https://api.openai.com/v1").rstrip("/")
        url = f"{base}/models"
        headers = {"User-Agent": "ChatVein/0.1", "Accept": "application/json"}
        if entity.api_key:
            headers["Authorization"] = f"Bearer {decrypt_secret(entity.api_key) or ''}"

        started = time.perf_counter()
        try:
            with httpx.Client(timeout=15) as client:
                resp = client.get(url, headers=headers)
            if resp.status_code >= 300:  # 与 urllib 口径一致：重定向 / 错误码都算探测失败
                raise httpx.HTTPStatusError(
                    f"HTTP {resp.status_code}", request=resp.request, response=resp
                )
            latency_ms = int((time.perf_counter() - started) * 1000)
            # 粗看是否像模型列表；非 JSON 响应也算「连上了」
            model_count: int | None = None
            try:
                parsed = resp.json()
                if isinstance(parsed, dict) and isinstance(parsed.get("data"), list):
                    model_count = len(parsed["data"])
            except ValueError:
                pass
            return {
                "ok": True,
                "status_code": resp.status_code,
                "latency_ms": latency_ms,
                "message": f"连接成功" + (f"，列出 {model_count} 个模型" if model_count is not None else ""),
                "url": url,
            }
        except Exception as exc:  # noqa: BLE001 — 探测接口：连接 / 超时 / 非法 URL 都转成失败信息
            latency_ms = int((time.perf_counter() - started) * 1000)
            if isinstance(exc, httpx.HTTPStatusError):
                code = exc.response.status_code
                detail = exc.response.text[:200]
                return {
                    "ok": False,
                    "status_code": code,
                    "latency_ms": latency_ms,
                    "message": f"HTTP {code}" + (f"：{detail}" if detail else ""),
                    "url": url,
                }
            return {
                "ok": False,
                "status_code": None,
                "latency_ms": latency_ms,
                "message": str(exc) or type(exc).__name__,
                "url": url,
            }

    def get_entity(self, model_id: str) -> LlmModel | None:
        """按 id 取模型实体（``api_key`` 已解密为明文），供角色绑定模型时使用。"""
        entity = self._repo.find_by_id(model_id)
        if entity is not None and entity.api_key:
            entity.api_key = decrypt_secret(entity.api_key)
        return entity

    def seed_from_env_if_empty(self) -> LlmModelResponseDto | None:
        """库为空且环境有 OPENAI_API_KEY 时，写入一条基础配置。

        仅写入基础字段，不再标记「主/默认」；是否使用仍取决于角色是否绑定。
        """
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
            description="由环境变量 OPENAI_* 自动导入",
        )
        return self.create_model(dto)
