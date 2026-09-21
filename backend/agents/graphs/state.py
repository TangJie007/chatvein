"""对话流水线共享状态。"""

from __future__ import annotations

from typing import Any, TypedDict


class ChatState(TypedDict, total=False):
    """``understand`` → 按难度进不同图的共享字段。"""

    message: str
    rewritten: str
    difficulty: str
    route_reason: str
    selected_tools: list[str]
    tool_plan_reason: str
    reply: str
    used_llm: bool
    history: list[dict[str, Any]]
    tool_trace: list[dict[str, Any]]
    extras: dict[str, Any]
