"""追踪模块组装。"""

from fastapi import APIRouter

from .controller import trace_controller
from .service import trace_service

trace_router = APIRouter(prefix="/api/conversations", tags=["trace"])
trace_router.include_router(trace_controller)

__all__ = ["trace_router", "trace_service"]
