"""模块组装：导出 ``/api/mcp-servers`` 路由与启动钩子。

启动钩子**只起后台线程**：lifespan 里同步拉起 stdio 子进程会让 Rust 侧 20 秒的
就绪探测超时（与 ``embeddings/module.py`` 同一个坑）。
"""

from fastapi import APIRouter

from . import state
from .controller import mcp_servers_controller

mcp_servers_router = APIRouter(prefix="/api/mcp-servers", tags=["mcp-servers"])
mcp_servers_router.include_router(mcp_servers_controller)


def on_module_init() -> None:
    """连接启用的外部 server（后台线程，不阻塞启动）。"""
    state.startup()


def on_shutdown() -> None:
    """停掉所有外部连接，别留孤儿子进程（Tauri 退出时尤其重要）。"""
    state.disconnect_all()


__all__ = ["mcp_servers_router", "on_module_init", "on_shutdown"]
