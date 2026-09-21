"""追踪模块组装。"""

from fastapi import APIRouter

from .controller import trace_controller
from .service import TraceService

trace_router = APIRouter(prefix="/api/conversations", tags=["trace"])
trace_router.include_router(trace_controller)

trace_service = TraceService()
