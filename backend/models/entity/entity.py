"""LLM 模型表实体（NestJS Entity 对应物）。

表名 ``llm_models``；由 ``db.init_db`` → ``SQLModel.metadata.create_all`` 建表。
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

    is_default: bool = Field(default=False, index=True)
    is_primary: bool = Field(default=False, index=True)
    enabled: bool = Field(default=True)

    description: str = Field(default="", max_length=500)
    created_at: datetime = Field(default_factory=_utc_now)
    updated_at: datetime = Field(default_factory=_utc_now)
