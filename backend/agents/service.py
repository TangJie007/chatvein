"""聊天入口：理解(改写+难度) → 按难度进不同 LangGraph（全程主模型）。

流水线见 ``agents.graphs.pipeline``：
- simple：单节点直答图
- medium：选型 → ReAct（``create_agent`` 编译的 agent⇄tools 循环）
- hard：同 ReAct 结构，更强 system（后续可再拆独立图）

``history`` 为短期记忆（不含本轮用户句），来自会话 ``logs/session.sqlite``。
"""

from __future__ import annotations

from typing import Any

from .graphs.pipeline import run_pipeline


def run_chat(
    message: str,
    *,
    history: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """``{reply, used_llm, difficulty, rewritten, tool_trace, ...}``。"""
    return run_pipeline(message, history=history)
