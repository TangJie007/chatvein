"""角色表实体（NestJS Entity 对应物）。

表名 ``roles``；由 ``db.init_db`` → ``SQLModel.metadata.create_all`` 建表。

``tools`` / ``kb`` 以 JSON 文本存取（保持与 SQLite 的兼容性，避免依赖
SQLAlchemy 的 JSON 列方言）。序列化 / 反序列化在 ``service`` 层完成。
"""

from datetime import datetime, timezone

from sqlmodel import Field, SQLModel


def _utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Role(SQLModel, table=True):
    """用户可配置的角色（人格 / 模型 / 工具 / 生成参数）。"""

    __tablename__ = "roles"  # pyright: ignore[reportAssignmentType]

    id: str = Field(primary_key=True, max_length=64)
    name: str = Field(max_length=120)
    # 一句话描述（列表副标题 / 群组花名册 / 委托任务派发参考）
    description: str = Field(default="", max_length=200)
    # 列表头像上的单字，缺省取 name 首字
    initial: str = Field(default="", max_length=8)
    # 头像图标文件名（如 avatar-11.png / avatar-user.png），空串表示用 initial 色块
    avatar: str = Field(default="", max_length=64)
    # 系统提示词（人格与行为边界）
    prompt: str = Field(default="")
    # 绑定模型 id；空串表示「主对话模型（自动）」
    model_id: str = Field(default="", max_length=64)
    tone: str = Field(default="brand", max_length=16)
    temperature: float = Field(default=0.7)
    max_tokens: int = Field(default=4096)
    presence_penalty: float = Field(default=0.0)
    frequency_penalty: float = Field(default=0.0)
    stream: bool = Field(default=True)
    json_mode: bool = Field(default=False)
    retries: int = Field(default=2)
    # 带入上下文的最近对话轮数
    memory: int = Field(default=8)
    enabled: bool = Field(default=True)
    # JSON 文本：工具 id 列表
    tools: str = Field(default="[]")
    # JSON 文本：知识库名称列表
    kb: str = Field(default="[]")
    # JSON 文本：常驻技能 slug 列表；聊天时自动注入 role prompt
    resident_skills: str = Field(default="[]")
    # 在用会话数（展示用，目前由聊天侧统计回填）
    sessions: int = Field(default=0)
    # 内置主角色，可改人格与工具，不可删除
    primary: bool = Field(default=False, index=True)
    created_at: datetime = Field(default_factory=_utc_now)
    updated_at: datetime = Field(default_factory=_utc_now)
