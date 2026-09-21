"""工具执行：按名 invoke，不含 Agent / 选型。"""

from __future__ import annotations

from .registry import invoke_tools


def run_tools(message: str, names: list[str]) -> str:
    """直接执行已选工具，返回拼接后的原始结果文本。"""
    return invoke_tools((message or "").strip(), list(names))
