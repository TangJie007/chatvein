"""短期记忆：会话消息 → LangChain messages。"""

from __future__ import annotations

from typing import Any

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage

# 送入模型的最近轮次窗口（user+assistant 对大约各占一半）
DEFAULT_HISTORY_LIMIT = 24


def to_lc_messages(
    history: list[dict[str, Any]] | None,
    *,
    limit: int = DEFAULT_HISTORY_LIMIT,
) -> list[BaseMessage]:
    """把落库/会话库消息转成可喂给 Agent 的历史（不含本轮用户句）。"""
    if not history:
        return []
    rows = history[-max(1, limit) :]
    out: list[BaseMessage] = []
    for row in rows:
        role = str(row.get("role") or "")
        content = str(row.get("content") or "").strip()
        if not content:
            continue
        if role == "user":
            out.append(HumanMessage(content=content))
        elif role == "assistant":
            out.append(AIMessage(content=content))
        elif role == "system":
            out.append(SystemMessage(content=content))
        # tool 角色不直接回灌，避免无绑定 tool_call_id 的脏消息
    return out
