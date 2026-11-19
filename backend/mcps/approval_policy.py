"""审批策略集中化：判断「哪些动作需要人点头」，并把判定结果包成审批请求。

为什么要抽出来：命令分级（`bash_policy` / `powershell_policy`）、会话外路径
（`path_access`）此前各自弹窗，策略散在工具实现里；统一后工具只负责描述
「我在做什么」，集中在这里决定 kind / risk / 文案，后续接外部 MCP 工具时
只需在这里加一条判定。
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Literal

DecisionKind = Literal["allow", "ask", "deny"]


@dataclass(frozen=True)
class ApprovalNeed:
    """一个待确认动作的人话描述（不进模型上下文，只给人看）。"""

    kind: str  # bash | powershell | path | mcp_tool | memory_write
    title: str
    detail: str
    risk: str  # low | medium | high


_SHELL_TITLES = {
    "bash": "允许执行这条命令？",
    "powershell": "允许执行这条 PowerShell 命令？",
}


def shell_approval(command: str, *, shell: str, cwd: str = "") -> ApprovalNeed:
    """``ask`` 分级时调用方构造它；``allow`` / ``deny`` 不走这里。"""
    text = (command or "").strip()
    detail = text if not cwd or cwd == "." else f"{text}\n目录: {cwd}"
    return ApprovalNeed(
        kind=shell,
        title=_SHELL_TITLES.get(shell, "允许执行这条命令？"),
        detail=detail,
        # 需要确认的都是可能改动工作区的命令；risk 留给前端文案用。
        risk="high" if len(text) > 200 else "medium",
    )


def path_approval(target: Path, action: str) -> ApprovalNeed:
    """会话外路径访问：kind=path，detail 里第一行是动作，第二行是路径。"""
    return ApprovalNeed(
        kind="path",
        title="允许访问会话外路径？",
        detail=f"{action}\n{target}",
        risk="medium",
    )


def permission_approval(tool: str, arguments: dict | None, reason: str) -> ApprovalNeed:
    """权限规则判成 ``ask``：弹同一套弹窗，只是 kind=permission。"""
    import json

    try:
        shown = json.dumps(arguments or {}, ensure_ascii=False, indent=2)
    except (TypeError, ValueError):
        shown = str(arguments)
    if len(shown) > 600:
        shown = shown[:600] + " …"
    lines = [reason.strip()] if reason.strip() else []
    lines.append(shown)
    return ApprovalNeed(
        kind="permission",
        title=f"允许调用工具 {tool}？",
        detail="\n".join(lines),
        risk="medium",
    )


def mcp_tool_approval(server: str, tool: str, arguments: dict | None) -> ApprovalNeed:
    """外部 MCP 工具调用：默认「问」，用户知道自己在给哪个 server 放行。"""
    import json

    try:
        shown = json.dumps(arguments or {}, ensure_ascii=False, indent=2)
    except (TypeError, ValueError):
        shown = str(arguments)
    if len(shown) > 600:
        shown = shown[:600] + " …"
    return ApprovalNeed(
        kind="mcp_tool",
        title=f"允许调用外部工具 {server}/{tool}？",
        detail=shown,
        risk="medium",
    )


__all__ = [
    "ApprovalNeed",
    "DecisionKind",
    "mcp_tool_approval",
    "path_approval",
    "permission_approval",
    "shell_approval",
]
