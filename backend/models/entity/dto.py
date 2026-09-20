"""请求 / 响应 DTO（NestJS DTO 对应物）。"""

from pydantic import BaseModel, Field


class CreateLlmModelDto(BaseModel):
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
    is_default: bool = False
    is_primary: bool = False
    enabled: bool = True
    description: str = Field(default="", max_length=500)


class UpdateLlmModelDto(BaseModel):
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
    is_default: bool | None = None
    is_primary: bool | None = None
    enabled: bool | None = None
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
    is_default: bool
    is_primary: bool
    enabled: bool
    description: str
    created_at: str
    updated_at: str
