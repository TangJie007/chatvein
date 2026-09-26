"""知识库管理模块 DTO（NestJS DTO 对应物）。"""

from pydantic import BaseModel, Field

_TITLE_MAX = 500
_CONTENT_MAX = 100_000
_SOURCE_MAX = 500


class KbDocOut(BaseModel):
    """知识库文档出参（列表 / 详情 / 命中共用）。"""

    id: str
    title: str
    content: str
    source: str
    created_at: str
    indexed: bool
    char_count: int


class KbCreateIn(BaseModel):
    """新增文档入参。"""

    title: str = Field(default="untitled", max_length=_TITLE_MAX)
    content: str = Field(min_length=1, max_length=_CONTENT_MAX)
    source: str = Field(default="", max_length=_SOURCE_MAX)


class KbUpdateIn(BaseModel):
    """更新文档入参：只更新非 None 字段。"""

    title: str | None = Field(default=None, max_length=_TITLE_MAX)
    content: str | None = Field(default=None, min_length=1, max_length=_CONTENT_MAX)
    source: str | None = Field(default=None, max_length=_SOURCE_MAX)


class KbSearchIn(BaseModel):
    """语义 / 关键词检索入参。"""

    query: str = Field(min_length=1, max_length=2000)
    limit: int = Field(default=5, ge=1, le=20)
    hybrid: bool = Field(default=False, description="混合检索(RRF 融合)，替代需额外模型的 rerank")


class KbImportItemIn(BaseModel):
    """批量导入的单个条目（标题 + 正文 + 来源）。"""

    title: str = Field(default="untitled", max_length=_TITLE_MAX)
    content: str = Field(min_length=1, max_length=_CONTENT_MAX)
    source: str = Field(default="", max_length=_SOURCE_MAX)


class KbImportIn(BaseModel):
    """批量导入入参（前端读取文本文件 / 粘贴文本后整体提交）。"""

    items: list[KbImportItemIn] = Field(default_factory=list, max_length=200)


class KbListOut(BaseModel):
    total: int
    items: list[KbDocOut]
    limit: int
    offset: int
