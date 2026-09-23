"""LLM 模型表实体（NestJS Entity 对应物）。

表名 ``llm_models``；由 ``db.init_db`` → ``SQLModel.metadata.create_all`` 建表。

设计原则：**每个模型都是平等的配置项**。应用不再区分「主模型 / 默认模型」，
运行时选择由角色侧的 ``role.model_id`` 决定，没有角色的聊天路径会直接返回
"暂未给角色配置模型"，而不是走回退链。
"""

import uuid
from datetime import datetime, timezone

from sqlmodel import Field, SQLModel


def _utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class LlmModel(SQLModel, table=True):
    """线上 / OpenAI 兼容模型配置。"""

    __tablename__ = "llm_models"  # pyright: ignore[reportAssignmentType]

    id: str = Field(default_factory=lambda: uuid.uuid4().hex, primary_key=True, max_length=64)
    name: str = Field(max_length=120)
    provider: str = Field(default="openai", max_length=80)
    # 供应商侧的模型 ID，如 gpt-4o-mini
    model_id: str = Field(max_length=120)
    base_url: str | None = Field(default=None, max_length=500)
    api_key: str | None = Field(default=None, max_length=500)

    temperature: float = Field(default=0.7)
    max_tokens: int = Field(default=4096)
    presence_penalty: float = Field(default=0.0)
    frequency_penalty: float = Field(default=0.0)
    stream: bool = Field(default=True)
    json_mode: bool = Field(default=False)
    retries: int = Field(default=2)
    # 上下文窗口（千 tokens），供 UI 展示
    context_window_k: int = Field(default=128)

    enabled: bool = Field(default=True)

    description: str = Field(default="", max_length=500)
    created_at: datetime = Field(default_factory=_utc_now)
    updated_at: datetime = Field(default_factory=_utc_now)
