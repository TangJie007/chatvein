"""团队模式：``delegate_to_agent`` 工具 —— 主 agent 把子任务派发给花名册成员。

设计要点：
- 花名册注入在 ``main._chat_turn``：``req.group_members`` 非空时把成员
  （名字 + 一句话描述 + role id）注入主 agent 的 role prompt，并标记 ``_team_mode``。
- 本工具只挂在团队模式会话：``medium`` / ``hard`` 的 ``react_node`` 在
  ``role._team_mode`` 时把 ``DELEGATE_TOOL`` 追加进工具列表（不参与选型 / 白名单）。
- 独立短期记忆：每次派发前先取该成员名下历史（会话库 ``actor_id=role_id`` 的消息）
  作为其短期记忆；派发完成的回复经 ``record_turn(actor_id=role_id)`` 写回成员名下，
  形成成员各自独立的记忆链，主 agent 与其他成员互不串线。
- 防递归：成员子 agent 只挂成员自己的工具 + 常驻工具，不挂 ``delegate_to_agent``。
"""

from __future__ import annotations

from contextvars import ContextVar
from typing import Any

from langchain_core.messages import BaseMessage, HumanMessage
from langchain_core.tools import BaseTool, tool
from pydantic import BaseModel, Field

from agents.graphs.common import (  # pyright: ignore[reportImplicitRelativeImport]
    ALWAYS_ON_TOOLS,
    build_react_graph,
    invoke_react,
    last_text,
    react_recursion_limit,
)
from agents.graphs.prompts import build_agent_system  # pyright: ignore[reportImplicitRelativeImport]
from agents.llm import get_chat_model  # pyright: ignore[reportImplicitRelativeImport]
from agents.memory import to_lc_messages  # pyright: ignore[reportImplicitRelativeImport]
from mcps import resolve_tools  # pyright: ignore[reportImplicitRelativeImport]

# 成员子 agent 的护栏量级（对齐 medium 图默认值）。
_LLM_TIMEOUT = 120.0
_REACT_DEADLINE_S = 300.0
_MAX_MODEL_CALLS = 12
_MAX_TOOL_CALLS = 10
_MAX_WEB_SEARCH = 3
_RECURSION_LIMIT = react_recursion_limit(_MAX_MODEL_CALLS)

#: 团队运行上下文：由 ``/api/chat`` 在开启团队模式时设置。
#: ``workspace_dir``：当前会话工作区目录名（写回成员记忆用）。
#: ``roster``：``{role_id: {"name":..., "description":...}}`` 可派发的花名册成员。
_team_ctx: ContextVar[dict[str, Any] | None] = ContextVar(
    "chatvein_team_ctx", default=None
)


def set_team_context(ctx: dict[str, Any] | None) -> None:
    """设置当前请求的团队上下文（主 agent ReAct 的 delegate 工具读取）。"""
    _team_ctx.set(ctx)


def get_team_context() -> dict[str, Any] | None:
    return _team_ctx.get()


class DelegateToAgentInput(BaseModel):
    role_id: str = Field(description="目标团队成员的角色 id（必须是花名册里的成员）")
    task: str = Field(description="交给该成员独立完成的子任务说明，尽量具体、可验收")
    instruction: str | None = Field(
        default=None,
        description="可选：额外的约束 / 期望的输出格式 / 注意事项",
    )


@tool("delegate_to_agent", args_schema=DelegateToAgentInput)
def delegate_to_agent(role_id: str, task: str, instruction: str | None = None) -> str:
    """把子任务派发给花名册中的某个团队成员，返回该成员独立完成的回复。

    这是团队协作的任务拆分入口：当用户请求可拆成若干独立子任务时，
    先按领域/职责给每个子任务挑选最合适的成员，然后为每个子任务各调用一次
    本工具（一次可连续调用多次，派发给不同成员），最后汇总各成员回复。
    团队成员会用自己绑定的模型、自己的工具和自己独立的短期记忆完成任务。
    若任务量小、不需要分工，直接自己完成即可，不必调用本工具。
    """
    ctx = _team_ctx.get()
    if not ctx:
        return "团队上下文不可用：当前不是团队模式会话，无法派发子任务。"
    roster = ctx.get("roster") or {}
    if role_id not in roster:
        names = "、".join(
            f"{m.get('name')}({rid})" for rid, m in roster.items()
        ) or "（无）"
        return f"花名册中没有角色 id={role_id}。可用成员：{names}"

    from roles.service import RolesService  # pyright: ignore[reportImplicitRelativeImport]

    member_runtime = RolesService().get_runtime(role_id)
    if member_runtime is None:
        return f"角色 {role_id} 不存在或已被删除。"
    member_name = str(member_runtime.get("name") or role_id)
    if not (member_runtime.get("model_id") or "").strip():
        return f"成员「{member_name}」未配置模型，无法派发子任务。"

    from conversations.module import (  # pyright: ignore[reportImplicitRelativeImport]
        conversations_service,
    )

    workspace_dir = str(ctx.get("workspace_dir") or "")
    memory_limit = 24
    try:
        memory_limit = max(0, min(60, int(member_runtime.get("memory") or 8) * 2))
    except (TypeError, ValueError):
        memory_limit = 24
    history = conversations_service.short_term_memory(
        workspace_dir, actor_id=role_id, limit=memory_limit
    )

    model = get_chat_model(role=member_runtime, timeout=_LLM_TIMEOUT)
    if model is None:
        return f"成员「{member_name}」的模型不可用，无法派发子任务。"

    member_tools = [
        str(t) for t in (member_runtime.get("tools") or []) if str(t).strip()
    ]
    names = list(dict.fromkeys([*member_tools, *ALWAYS_ON_TOOLS]))
    tools = resolve_tools(names)
    member_prompt = str(member_runtime.get("prompt") or "").strip()
    agent = build_react_graph(
        model,
        tools,
        system_prompt=build_agent_system(
            tier="medium",
            role_prompt=member_prompt or None,
        ),
        name="delegate_react",
        max_model_calls=_MAX_MODEL_CALLS,
        max_tool_calls=_MAX_TOOL_CALLS,
        max_web_search=_MAX_WEB_SEARCH,
    )
    user_blob = task.strip()
    if instruction and str(instruction).strip():
        user_blob = f"{user_blob}\n\n约束与期望：{str(instruction).strip()}"

    prior: list[BaseMessage] = to_lc_messages(history)
    out = invoke_react(
        agent,
        {"messages": [*prior, HumanMessage(content=user_blob)]},
        recursion_limit=_RECURSION_LIMIT,
        deadline_s=_REACT_DEADLINE_S,
    )
    out_messages = out.get("messages") or []
    reply = last_text(out_messages) or "（成员未返回文本回复）"

    # 写回成员名下，形成成员独立的记忆链（主 agent / 其他成员不受影响）。
    try:
        conversations_service.record_turn(
            workspace_dir,
            user_text=f"[主 agent 派发]\n{user_blob}",
            reply_text=reply,
            used_llm=True,
            route="delegate",
            actor_id=role_id,
        )
    except Exception:  # noqa: BLE001
        pass

    return f"[成员 {member_name} 的回复]\n{reply}"


TOOLS: tuple[BaseTool, ...] = (delegate_to_agent,)
#: medium / hard 的 react_node 在团队模式下追加挂载的入口（= delegate_to_agent）。
DELEGATE_TOOL: BaseTool = delegate_to_agent

__all__ = [
    "TOOLS",
    "DELEGATE_TOOL",
    "delegate_to_agent",
    "get_team_context",
    "set_team_context",
]
