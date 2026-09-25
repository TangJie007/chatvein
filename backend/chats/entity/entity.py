"""chats.entity：群组 / 团队相关的表实体。

与 conversations 的纯会话管理解耦：群组成员独立存于 ``chat_groups`` 表，
``conversation_id`` 外键指向会话（级联删除），Python 层不再互相持有。
"""

from datetime import datetime

from sqlalchemy import Column, ForeignKey, String
from sqlmodel import Field, SQLModel

from db import utc_now  # pyright: ignore[reportImplicitRelativeImport]


class ChatGroup(SQLModel, table=True):
    """会话的群组成员（角色 id 列表）。

    ``conversation_id`` 与会话一一对应，外键级联删除：会话被删除时该行自动清理。
    群组 / 团队模式的「花名册」来源即此表，与会话元数据物理解耦。
    """

    __tablename__ = "chat_groups"  # pyright: ignore[reportAssignmentType]

    conversation_id: str = Field(
        sa_column=Column(
            "conversation_id",
            String(64),
            ForeignKey("conversations.id", ondelete="CASCADE"),
            primary_key=True,
        )
    )
    # 群组成员（JSON 文本：角色 id 列表）。@ 指派 / 团队模式标识该会话的参与成员。
    members: str = Field(default="[]", max_length=4096)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
