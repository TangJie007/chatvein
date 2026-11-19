"""记忆模块的输入契约 + 抽取用的结构化 schema。"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

MemoryKind = Literal["fact", "preference", "identity", "project", "other"]
MemoryScope = Literal["global", "role", "conversation"]
MemoryStatus = Literal["pending", "active"]


class CreateMemoryDto(BaseModel):
    content: str = Field(min_length=1, max_length=300, description="一句陈述，别写成一整段")
    kind: MemoryKind = Field(default="fact")
    scope: MemoryScope = Field(default="global", description="global 对所有会话生效")
    scope_id: str | None = Field(default=None, description="role / conversation 作用域的 id")
    status: MemoryStatus = Field(default="active", description="手动新增默认直接生效")
    confidence: float = Field(default=1.0, ge=0, le=1)


class UpdateMemoryDto(BaseModel):
    content: str | None = Field(default=None, min_length=1, max_length=300)
    kind: MemoryKind | None = None
    status: MemoryStatus | None = None
    confidence: float | None = Field(default=None, ge=0, le=1)


class ExtractedItem(BaseModel):
    """抽取模型单条输出。``content`` 用第三人称陈述，避免把用户的第二人称原话搬进来。"""

    kind: MemoryKind = Field(default="fact", description="事实 / 偏好 / 身份 / 项目 / 其他")
    content: str = Field(description="一条可独立成立的陈述，不超过 80 字")
    confidence: float = Field(default=0.7, ge=0, le=1)


class ExtractResult(BaseModel):
    """抽取结果；模型没有可记的信息时必须返回空 ``items``。"""

    items: list[ExtractedItem] = Field(default_factory=list)
