"""MCP / 工具域：注册表 + 按名执行。

- 工具选择 Agent → ``agents.tool_selector``（只缩候选集，省 token）
- Tool-calling Agent → ``agents.service``（绑子集后跑一轮）
- 本包不建 Agent；工具实现见 ``mcps.tools``
"""

from .registry import (
    resolve_tools,
    suggest_tools_route,
    tool_catalog,
    tool_catalog_text,
    tool_groups,
)
from .service import run_tools

__all__ = [
    "run_tools",
    "resolve_tools",
    "suggest_tools_route",
    "tool_catalog",
    "tool_catalog_text",
    "tool_groups",
]
