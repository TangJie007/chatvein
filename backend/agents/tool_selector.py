"""工具选择 Agent：从 mcps 工具目录里选出本轮要用的工具。"""

from __future__ import annotations

from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field

from mcps.registry import (  # pyright: ignore[reportImplicitRelativeImport]
    heuristic_tool_names,
    tool_catalog_text,
)

from . import llm as llm_mod

_SYSTEM = """你是工具选择 Agent。根据用户问题与工具清单，选出需要的工具名（可多选）。
不要编造清单外的名字；不需要工具则返回空列表。只输出结构化字段。"""


class ToolPlan(BaseModel):
    tool_names: list[str] = Field(default_factory=list)
    reason: str = Field(description="为何选这些工具")


def select_tools(message: str) -> dict[str, Any]:
    """返回 ``{selected_tools, tool_plan_reason, used_llm}``。"""
    text = (message or "").strip()
    catalog = tool_catalog_text()
    model = llm_mod.get_chat_model(temperature=0)
    if model is None:
        names = heuristic_tool_names(text) or ["get_current_time"]
        return {
            "selected_tools": names,
            "tool_plan_reason": "启发式工具选择",
            "used_llm": False,
        }

    try:
        plan = llm_mod.invoke_structured(
            model,
            ToolPlan,
            [
                SystemMessage(content=f"{_SYSTEM}\n\n可用工具:\n{catalog}"),
                HumanMessage(content=text or "(空)"),
            ],
        )
        if not isinstance(plan, ToolPlan):
            plan = ToolPlan.model_validate(plan)
        names = [n for n in plan.tool_names if n] or heuristic_tool_names(text) or [
            "get_current_time"
        ]
        return {
            "selected_tools": names,
            "tool_plan_reason": plan.reason,
            "used_llm": True,
        }
    except Exception as exc:  # noqa: BLE001
        names = heuristic_tool_names(text) or ["get_current_time"]
        return {
            "selected_tools": names,
            "tool_plan_reason": f"选择失败({exc}); 已回落启发式",
            "used_llm": False,
        }
