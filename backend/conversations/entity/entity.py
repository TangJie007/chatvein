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
