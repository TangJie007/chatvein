"""追踪 HTTP。"""

from fastapi import APIRouter, HTTPException

from .service import TraceService

trace_controller = APIRouter()
_service = TraceService()


@trace_controller.get("/{conversation_id}/traces")
def list_traces(conversation_id: str):
    traces = _service.list_traces(conversation_id)
    if traces is None:
        raise HTTPException(status_code=404, detail="会话不存在")
    return {"traces": traces}


@trace_controller.get("/{conversation_id}/traces/{turn_id}")
def get_trace(conversation_id: str, turn_id: str):
    trace = _service.get_trace(conversation_id, turn_id)
    if trace is None:
        raise HTTPException(status_code=404, detail="没有这一轮的追踪")
    return trace
