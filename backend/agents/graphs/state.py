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
    candidate_tools: list[str]
    # 角色运行时配置（RolesService.get_runtime），为空表示不套用角色
    role: dict[str, Any] | None
    # hard：规划与核对
    plan: dict[str, Any]
    plan_text: str
    verify_passed: bool
    verify_reason: str
    verify_focus: str
    verify_round: int
    extras: dict[str, Any]
