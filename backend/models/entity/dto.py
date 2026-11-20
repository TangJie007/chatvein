"""请求 / 响应 DTO（NestJS DTO 对应物）。

模型之间没有主次之分，配置项不再包含 ``is_default`` / ``is_primary`` 字段。
"""

from typing import Any

from pydantic import BaseModel, Field, field_validator


class _PriceFields(BaseModel):
    """价格字段的口径：空串与 ``null`` 都表示「清除」。

    前端清空输入框时会发 ``""``；不做这一步就只能 422，用户看到的是「保存失败」。
    """

    @field_validator("price_input", "price_output", mode="before", check_fields=False)
    @classmethod
    def _blank_price_is_none(cls, value: Any) -> Any:
        return None if isinstance(value, str) and not value.strip() else value


class CreateLlmModelDto(_PriceFields):
    name: str = Field(min_length=1, max_length=120)
    provider: str = Field(default="openai", max_length=80)
    model_id: str = Field(min_length=1, max_length=120)
    base_url: str | None = Field(default=None, max_length=500)
    api_key: str | None = Field(default=None, max_length=500)
    temperature: float = Field(default=0.7, ge=0, le=2)
    max_tokens: int = Field(default=4096, ge=1, le=1_000_000)
    presence_penalty: float = Field(default=0.0, ge=-2, le=2)
    frequency_penalty: float = Field(default=0.0, ge=-2, le=2)
    stream: bool = True
    json_mode: bool = False
    retries: int = Field(default=2, ge=0, le=10)
    context_window_k: int = Field(default=128, ge=1, le=10_000)
    enabled: bool = True
    #: 备用模型（必须指向另一条已启用配置）；价格按「每百万 token」填，可留空。
    fallback_config_id: str | None = None
    price_input: float | None = Field(default=None, ge=0)
    price_output: float | None = Field(default=None, ge=0)
    description: str = Field(default="", max_length=500)


class UpdateLlmModelDto(_PriceFields):
    """部分更新：未传字段保持原值；``api_key`` 传空字符串表示清空。"""

    name: str | None = Field(default=None, min_length=1, max_length=120)
    provider: str | None = Field(default=None, max_length=80)
    model_id: str | None = Field(default=None, min_length=1, max_length=120)
    base_url: str | None = None
    api_key: str | None = None
    temperature: float | None = Field(default=None, ge=0, le=2)
    max_tokens: int | None = Field(default=None, ge=1, le=1_000_000)
    presence_penalty: float | None = Field(default=None, ge=-2, le=2)
    frequency_penalty: float | None = Field(default=None, ge=-2, le=2)
    stream: bool | None = None
    json_mode: bool | None = None
    retries: int | None = Field(default=None, ge=0, le=10)
    context_window_k: int | None = Field(default=None, ge=1, le=10_000)
    enabled: bool | None = None
    #: 传空字符串表示清除备用模型（价格见 ``_PriceFields``）。
    fallback_config_id: str | None = None
    price_input: float | None = Field(default=None, ge=0)
    price_output: float | None = Field(default=None, ge=0)
    description: str | None = Field(default=None, max_length=500)


class LlmModelResponseDto(BaseModel):
    id: str
    name: str
    provider: str
    model_id: str
    base_url: str | None
    # 脱敏后的密钥展示；完整密钥不下发
    key_mask: str | None
    has_api_key: bool
    temperature: float
    max_tokens: int
    presence_penalty: float
    frequency_penalty: float
    stream: bool
    json_mode: bool
    retries: int
    context_window_k: int
    enabled: bool
    fallback_config_id: str | None
    price_input: float | None
    price_output: float | None
    description: str
    created_at: str
    updated_at: str
