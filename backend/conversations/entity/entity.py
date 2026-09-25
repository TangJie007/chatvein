"""会话表实体（消息只存在会话空间 session.sqlite，不在主库）。"""

import uuid
from datetime import datetime

from sqlmodel import Field, SQLModel

from db import utc_now  # pyright: ignore[reportImplicitRelativeImport]


class Conversation(SQLModel, table=True):
    """会话元数据。"""

    __tablename__ = "conversations"  # pyright: ignore[reportAssignmentType]

    id: str = Field(default_factory=lambda: uuid.uuid4().hex, primary_key=True, max_length=64)
    title: str = Field(default="", max_length=200)
    # 主空间内的会话目录名：YYYYMMDD-HHMMSS-xxxxx。空字符串表示旧数据尚未分配。
    workspace_dir: str = Field(default="", max_length=64)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
    # 会话级技能 slug 列表（JSON 文本）。常驻技能存角色 resident_skills，不在此列。
    skills: str = Field(default="[]", max_length=4096)
    # 冗余的消息数 / 最后一条消息预览：列表 / 计数查询直接读主库，不再逐个打开
    # 会话空间库 session.sqlite（消息写入路径同步维护这两个列）。
    message_count: int = Field(default=0)
    last_message: str = Field(default="", max_length=2048)
