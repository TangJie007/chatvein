"""工具执行：按名 invoke，不含 Agent / 选型。"""

from __future__ import annotations

from typing import Any

from .registry import invoke_tools, resolve_tools


def run_tools(message: str, names: list[str]) -> str:
    """直接执行已选工具，返回拼接后的原始结果文本。"""
    _ = resolve_tools(names)  # 校验/回退全部工具的语义保留在 invoke_tools 内
    return invoke_tools((message or "").strip(), list(names))
