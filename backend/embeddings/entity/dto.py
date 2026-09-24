"""请求 / 响应 DTO（NestJS DTO 对应物）。"""

from pydantic import BaseModel, Field


class EmbeddingStatusDto(BaseModel):
    """向量模型的安装 / 下载状态。"""

    model: str
    dim: int
    installed: bool
    cache_dir: str
    endpoint: str
    downloading: bool = False
    progress: float | None = None
    error: str | None = None


class PrepareEmbeddingDto(BaseModel):
    """触发模型下载；``force=True`` 时忽略已有缓存重新下载。"""

    force: bool = False


class EmbedDto(BaseModel):
    texts: list[str] = Field(default_factory=list, max_length=256)


class EmbedResponseDto(BaseModel):
    model: str
    dim: int
    vectors: list[list[float]]
