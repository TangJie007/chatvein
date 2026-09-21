"""工具选择 Agent：从 mcps 工具目录里选出本轮要用的工具。"""

from __future__ import annotations

from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field

from mcps.registry import (  # pyright: ignore[reportImplicitRelativeImport]
    all_tools,
    heuristic_tool_names,
    tool_groups,
)

from . import llm as llm_mod
from trace import span  # pyright: ignore[reportMissingImports]

_SYSTEM = """你是工具选择 Agent。根据用户问题与工具清单，选出需要的工具名（可多选）。
不要编造清单外的名字；不需要工具则返回空列表。只输出结构化字段。"""


class ToolPlan(BaseModel):
    tool_names: list[str] = Field(default_factory=list)
    reason: str = Field(description="为何选这些工具")


def expand_allowlist(allowed: list[str] | None) -> set[str] | None:
    """把角色勾选的分组 id / 工具名展开为具体工具名集合。

    - 空 / None → 不限制
    - ``mcp-web`` 等分组 id → 该组全部工具
    - 具体工具名 → 原样保留
    """
    if not allowed:
        return None
    groups = tool_groups()
    names: set[str] = set()
    for item in allowed:
        key = str(item).strip()
        if not key:
            continue
        if key in groups:
            names.update(groups[key])
        else:
            names.add(key)
    return names or None


def select_tools(
    message: str,
    *,
    allowed: list[str] | None = None,
) -> dict[str, Any]:
    """返回 ``{selected_tools, candidate_tools, tool_plan_reason, used_llm}``。

    ``allowed`` 为角色勾选的分组或工具名；空表示不限制。
    """
    text = (message or "").strip()
    tools = all_tools()
    allow_set = expand_allowlist(allowed)
    if allow_set is not None:
        tools = [t for t in tools if t.name in allow_set]
    candidates = [tool.name for tool in tools]
    if not candidates:
        return {
            "selected_tools": [],
            "candidate_tools": [],
            "tool_plan_reason": "角色未开放任何可用工具",
            "used_llm": False,
        }

    catalog = "\n".join(f"- {tool.name}: {tool.description}" for tool in tools)
    model = llm_mod.get_chat_model(temperature=0)
    if model is None:
        names = [n for n in heuristic_tool_names(text) if n in candidates]
        if not names:
            names = [candidates[0]]
        return {
            "selected_tools": names,
            "candidate_tools": candidates,
            "tool_plan_reason": "启发式工具选择",
            "used_llm": False,
        }

    try:
        with span("select_tools"):
            plan = llm_mod.invoke_structured(
                model,
                ToolPlan,
                [
                    SystemMessage(content=f"{_SYSTEM}\n\n可用工具:\n{catalog}"),
                    HumanMessage(content=text or "(空)"),
                ],
            )
        names = [n for n in plan.tool_names if n in candidates]
        if not names:
            names = [n for n in heuristic_tool_names(text) if n in candidates]
        if not names:
            names = [candidates[0]]
        return {
            "selected_tools": names,
            "candidate_tools": candidates,
            "tool_plan_reason": plan.reason,
            "used_llm": True,
        }
    except Exception as exc:  # noqa: BLE001
        names = [n for n in heuristic_tool_names(text) if n in candidates]
        if not names:
            names = [candidates[0]]
        return {
            "selected_tools": names,
            "candidate_tools": candidates,
            "tool_plan_reason": f"选择失败({exc}); 已回落启发式",
            "used_llm": False,
        }
