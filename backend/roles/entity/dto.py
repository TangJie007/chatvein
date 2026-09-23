"""请求 / 响应 DTO（NestJS DTO 对应物）。"""

from pydantic import BaseModel, Field


class CreateRoleDto(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    initial: str | None = Field(default=None, max_length=8)
    prompt: str | None = Field(default=None)
    # 绑定模型 id；空串 / None 表示「主对话模型（自动）」
    model_id: str | None = Field(default=None, max_length=64)
    tone: str | None = Field(default=None, max_length=16)
    temperature: float | None = Field(default=None, ge=0, le=2)
    max_tokens: int | None = Field(default=None, ge=1, le=1_000_000)
    presence_penalty: float | None = Field(default=None, ge=-2, le=2)
    frequency_penalty: float | None = Field(default=None, ge=-2, le=2)
    stream: bool | None = None
    json_mode: bool | None = None
    retries: int | None = Field(default=None, ge=0, le=10)
    memory: int | None = Field(default=None, ge=0, le=30)
    enabled: bool | None = None
    tools: list[str] | None = Field(default=None)
    kb: list[str] | None = Field(default=None)
    # 常驻技能 slug 列表；聊天时自动注入 role prompt（可与消息级临时技能叠加）
    resident_skills: list[str] | None = Field(default=None)
    primary: bool | None = None


class UpdateRoleDto(BaseModel):
    """部分更新：未传字段保持原值。"""

    name: str | None = Field(default=None, min_length=1, max_length=120)
    initial: str | None = Field(default=None, max_length=8)
    prompt: str | None = None
    model_id: str | None = None
    tone: str | None = None
    temperature: float | None = Field(default=None, ge=0, le=2)
    max_tokens: int | None = Field(default=None, ge=1, le=1_000_000)
    presence_penalty: float | None = Field(default=None, ge=-2, le=2)
    frequency_penalty: float | None = Field(default=None, ge=-2, le=2)
    stream: bool | None = None
    json_mode: bool | None = None
    retries: int | None = Field(default=None, ge=0, le=10)
    memory: int | None = Field(default=None, ge=0, le=30)
    enabled: bool | None = None
    tools: list[str] | None = None
    kb: list[str] | None = None
    resident_skills: list[str] | None = None
    primary: bool | None = None


class RoleResponseDto(BaseModel):
    id: str
    name: str
    initial: str
    prompt: str
    model_id: str
    tone: str
    temperature: float
    max_tokens: int
    presence_penalty: float
    frequency_penalty: float
    stream: bool
    json_mode: bool
    retries: int
    memory: int
    enabled: bool
    tools: list[str]
    kb: list[str]
    resident_skills: list[str]
    sessions: int
    primary: bool
    created_at: str
    updated_at: str
