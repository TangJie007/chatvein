"""知识库管理 HTTP 路由（NestJS Controller 对应物）。"""

from fastapi import APIRouter, HTTPException, Query

from .entity.dto import KbCreateIn, KbImportIn, KbSearchIn, KbUpdateIn
from .service import get_service

knowledge_controller = APIRouter()


@knowledge_controller.get("/status")
def get_status():
    """知识库概况：文档数 / 已索引数 / 向量可用性。"""
    return get_service().status()


@knowledge_controller.get("/docs")
def list_docs(
    q: str = Query(default="", max_length=200),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    """文档列表；``q`` 非空时按标题 / 正文子串过滤。"""
    return get_service().list_docs(q=q, limit=limit, offset=offset)


@knowledge_controller.get("/docs/{doc_id}")
def get_doc(doc_id: str):
    """单个文档详情。"""
    try:
        return get_service().get_doc(doc_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@knowledge_controller.post("/docs")
def create_doc(payload: KbCreateIn):
    """新增文档（正文非空；向量模型就绪时同步建索引）。"""
    try:
        return get_service().create_doc(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@knowledge_controller.put("/docs/{doc_id}")
def update_doc(doc_id: str, payload: KbUpdateIn):
    """更新文档标题 / 正文 / 来源（只更新非 None 字段），内容变更后自动重建向量。"""
    try:
        return get_service().update_doc(doc_id, payload)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@knowledge_controller.delete("/docs/{doc_id}")
def delete_doc(doc_id: str):
    """删除单篇文档（含向量）。"""
    try:
        return get_service().delete_doc(doc_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@knowledge_controller.delete("/docs")
def clear_docs():
    """清空知识库（含全部向量）。"""
    return get_service().clear()


@knowledge_controller.post("/search")
def search_docs(payload: KbSearchIn):
    """语义 / 关键词检索：向量模型就绪时优先向量召回，否则子串兜底。"""
    return {"items": get_service().search(payload.query, limit=payload.limit)}


@knowledge_controller.post("/import")
def import_docs(payload: KbImportIn):
    """批量导入文档（前端读取文本文件 / 粘贴文本后整体提交）。"""
    try:
        return get_service().import_items(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@knowledge_controller.post("/rebuild-index")
def rebuild_index():
    """全量重建向量索引（需要向量模型就绪，否则 409）。"""
    try:
        return get_service().rebuild_index()
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
