"""模块组装（NestJS Module 对应物）。

把 Controller 导出为可挂载的 ``APIRouter``；启动时的 ``on_module_init``
只打印状态，**刻意不触发下载**。
"""

from fastapi import APIRouter

from .controller import embeddings_controller
from .service import get_service

embeddings_router = APIRouter(prefix="/api/embeddings", tags=["embeddings"])
embeddings_router.include_router(embeddings_controller)


def on_module_init() -> None:
    """模块初始化钩子：只报告状态，不下载。

    lifespan 是同步阻塞的，在这里下载上百 MB 会让 Rust 侧 20 秒的就绪探测
    失败（``wait_for_backend``），前端会误报“Python 后端未就绪”。
    真正的下载由前端调用 ``POST /api/embeddings/prepare`` 触发。
    """
    status = get_service().status()
    print(
        f"CHATVEIN_EMBED model={status.model} installed={status.installed} "
        f"endpoint={status.endpoint} cache={status.cache_dir}",
        flush=True,
    )
