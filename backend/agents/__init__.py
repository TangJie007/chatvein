"""Agent 编排入口。

具体 Agent / 工具 / 图逻辑在本包内实现；``main`` 只调用 ``run_chat``。
"""

from .service import run_chat

__all__ = ["run_chat"]
