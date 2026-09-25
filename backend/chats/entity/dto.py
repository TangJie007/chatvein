"""chats 模块 DTO / 记录类型（群组 / 团队）。"""

from pydantic import BaseModel, Field


class GroupMembersDto(BaseModel):
    """补注册 / 更新群组成员（角色 id 列表，后端合并去重）。"""

    group_members: list[str] = Field(default_factory=list, max_length=50)


class ChatGroupRecord(BaseModel):
    """群组成员记录（会话 + 角色 id 列表）。"""

    conversation_id: str
    group_members: list[str]
