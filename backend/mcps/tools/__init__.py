"""内置工具包：对齐设置页 MCP 目录（core / fs / web / sqlite / kb / codesandbox）。"""

from __future__ import annotations

from langchain_core.tools import BaseTool

from . import core, fs, kb, sandbox, sqlite_tools, web

# (group_id, tools) — group_id 与前端 prefs.MCP_SERVERS.id 对齐；core 无 UI 条目
TOOL_GROUPS: dict[str, list[BaseTool]] = {
    "core": list(core.TOOLS),
    "mcp-fs": list(fs.TOOLS),
    "mcp-web": list(web.TOOLS),
    "mcp-sqlite": list(sqlite_tools.TOOLS),
    "mcp-kb": list(kb.TOOLS),
    "mcp-codesandbox": list(sandbox.TOOLS),
}

ALL_TOOLS: list[BaseTool] = [t for group in TOOL_GROUPS.values() for t in group]


def heuristic_hits(message: str) -> list[str]:
    """按关键词启发式命中工具名（离线回落）。"""
    text = (message or "").lower()
    names: list[str] = []
    for group in (core, fs, web, sqlite_tools, kb, sandbox):
        names.extend(group.heuristic(text))
    # 去重保序
    seen: set[str] = set()
    out: list[str] = []
    for n in names:
        if n not in seen:
            seen.add(n)
            out.append(n)
    return out


__all__ = ["ALL_TOOLS", "TOOL_GROUPS", "heuristic_hits"]
