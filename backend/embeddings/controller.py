"""HTTP 路由（NestJS Controller 对应物）。"""

from fastapi import APIRouter, HTTPException

from .entity import EmbedDto, PrepareEmbeddingDto
from .service import get_service

embeddings_controller = APIRouter()


@embeddings_controller.get("/status")
def get_status():
    """模型安装状态。前端启动时先查它，未安装则提示用户下载。"""
    return get_service().status()


@embeddings_controller.post("/prepare")
def prepare_model(payload: PrepareEmbeddingDto | None = None):
    """触发下载。后台线程执行，立即返回当前状态供前端轮询。"""
    force = payload.force if payload else False
    return get_service().prepare(force=force)


@embeddings_controller.post("/embed")
def embed_texts(payload: EmbedDto):
    service = get_service()
    if not payload.texts:
        return {"model": service.model_name, "dim": service.dimension, "vectors": []}
    try:
        vectors = service.embed(payload.texts)
    except RuntimeError as exc:
        # 409 而非 500：这是“前置条件未满足”，不是服务端故障
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"model": service.model_name, "dim": len(vectors[0]), "vectors": vectors}
