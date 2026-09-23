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

    - ``None`` / 空列表 → 不限制（返回 ``None``）
    - 非空勾选 → 返回 ``set``（可能为空：例如只勾了当前未注册的 ``mcp-bash``）
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
        elif key == "core" or key.startswith("mcp-"):
            # 已知分组家族但本机未挂载：不写成伪工具名
            continue
        else:
            names.add(key)
    return names


def _apply_allowlist(
    tools: list[Any],
    allowed: list[str] | None,
) -> tuple[list[Any], str | None]:
    allow_set = expand_allowlist(allowed)
    if allow_set is None:
        return tools, None

    filtered = [t for t in tools if t.name in allow_set]
    if filtered:
        return filtered, None

    raw = [str(x).strip() for x in (allowed or []) if str(x).strip()]
    groups = tool_groups()
    registered = {t.name for t in tools}
    touches_real = any(
        a in groups or a in registered or a == "core" or a.startswith("mcp-")
        for a in raw
    )
    if touches_real:
        return [], "角色勾选的工具当前均不可用"
    # 旧 WorkBuddy 演示 id（order.get 等）→ 不锁死角色
    return tools, "角色工具勾选无法匹配注册表（旧配置），已按全部可用工具处理"


def select_tools(
    message: str,
    *,
    allowed: list[str] | None = None,
    role: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """返回 ``{selected_tools, candidate_tools, tool_plan_reason, used_llm}``。

    模型明确表示无需工具时，``selected_tools`` 可为空白（不再强行塞一个工具）。
    ``role`` 用于取聊天模型；未绑定模型时走启发式。
    """
    text = (message or "").strip()
    tools, filter_note = _apply_allowlist(all_tools(), allowed)
    candidates = [tool.name for tool in tools]
    if not candidates:
        return {
            "selected_tools": [],
            "candidate_tools": [],
            "tool_plan_reason": filter_note or "角色未开放任何可用工具",
            "used_llm": False,
        }

    catalog = "\n".join(f"- {tool.name}: {tool.description}" for tool in tools)
    model = llm_mod.get_chat_model(role=role, temperature=0, streaming=False, thinking=False)

    def _with_note(reason: str) -> str:
        if filter_note:
            return f"{filter_note}；{reason}"
        return reason

    if model is None:
        names = [n for n in heuristic_tool_names(text) if n in candidates]
        reason = "启发式工具选择" if names else "启发式：无需工具"
        return {
            "selected_tools": names,
            "candidate_tools": candidates,
            "tool_plan_reason": _with_note(reason),
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
        reason = (plan.reason or "").strip() or ("已选工具" if names else "无需工具")
        return {
            "selected_tools": names,
            "candidate_tools": candidates,
            "tool_plan_reason": _with_note(reason),
            "used_llm": True,
        }
    except Exception as exc:  # noqa: BLE001
        names = [n for n in heuristic_tool_names(text) if n in candidates]
        return {
            "selected_tools": names,
            "candidate_tools": candidates,
            "tool_plan_reason": _with_note(f"选择失败({exc}); 已回落启发式"),
            "used_llm": False,
        }
