"""追踪 HTTP。"""

from fastapi import APIRouter, HTTPException

from .metrics import DEFAULT_SCAN_TURNS, DEFAULT_WINDOW_DAYS
from .service import trace_service

trace_controller = APIRouter()


@trace_controller.get("/{conversation_id}/metrics")
def get_metrics(
    conversation_id: str,
    days: int = DEFAULT_WINDOW_DAYS,
    scan: int = DEFAULT_SCAN_TURNS,
):
    """成功/失败/取消率、token 与耗时分布，以及告警。

    ``days`` 只影响轮次指标，``scan`` 决定工具失败率回看多少轮 payload。
    """
    metrics = trace_service.metrics(conversation_id, days=days, scan=scan)
    if metrics is None:
        raise HTTPException(status_code=404, detail="会话不存在")
    return metrics


@trace_controller.get("/{conversation_id}/traces")
def list_traces(conversation_id: str):
    traces = trace_service.list_traces(conversation_id)
    if traces is None:
        raise HTTPException(status_code=404, detail="会话不存在")
    return {"traces": traces}


@trace_controller.get("/{conversation_id}/traces/{turn_id}")
def get_trace(conversation_id: str, turn_id: str):
    trace = trace_service.get_trace(conversation_id, turn_id)
    if trace is None:
        raise HTTPException(status_code=404, detail="没有这一轮的追踪")
    return trace
