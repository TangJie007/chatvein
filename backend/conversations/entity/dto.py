"""会话模块 DTO / 记录类型。"""

from typing import Literal, TypedDict

from pydantic import BaseModel, Field

Role = Literal["user", "assistant", "system"]


class MessageRecord(TypedDict):
    id: int
    conversation_id: str
    role: str
    content: str
    used_llm: bool
    route: str | None
    created_at: str
    turn_id: str
    tokens: int
    duration_ms: int
    # 执行者（角色 id）：群组 @ 指派 / 按角色单独下达任务时标识由谁回复
    actor_id: str | None


class ConversationRecord(TypedDict):
    id: str
    title: str
    workspace_dir: str
    created_at: str
    updated_at: str
    message_count: int
    last_message: str | None
    # 会话级技能 slug 列表（Composer 勾选，当前会话持续生效）
    skills: list[str]
    # 绑定的角色 id（空表示用后端默认主角色）；新建会话时可选，之后该会话整体沿用。
    role_id: str | None


class CreateConversationDto(BaseModel):
    title: str = Field(default="", max_length=200)
    # 绑定的角色 id（可空）：新建会话时选定，该会话整体沿用此角色。
    role_id: str | None = Field(default=None, max_length=64)


class UpdateConversationRoleDto(BaseModel):
    """切换当前会话绑定的角色（可空 → 走后端默认主角色）。"""

    role_id: str | None = Field(default=None, max_length=64)


class UpdateConversationSkillsDto(BaseModel):
    """覆盖会话级技能集（全量替换，非增量）。"""

    skills: list[str] = Field(default_factory=list, max_length=100)
