"""图节点共用：抽文本、角色白名单、ReAct 工厂、轨迹合并。"""

from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FuturesTimeout
from typing import Any

from langchain.agents import create_agent
from langchain.agents.middleware import (
    ModelCallLimitMiddleware,
    ToolCallLimitMiddleware,
    wrap_tool_call,
)
from langchain_core.messages import ToolMessage


def last_text(messages: list[Any] | None) -> str | None:
    """从 Agent / 图输出的 messages 里取最后一条非空文本。"""
    for msg in reversed(messages or []):
        content = getattr(msg, "content", None)
        if isinstance(content, str) and content.strip():
            return content
        if isinstance(content, list):
            parts = [
                str(block.get("text", ""))
                for block in content
                if isinstance(block, dict) and block.get("type") == "text"
            ]
            joined = "".join(parts).strip()
            if joined:
                return joined
    return None


def session_workspace_block() -> str:
    """兼容别名：动态 Environment 段（见 ``graphs.prompts``）。"""
    from .prompts import environment_section

    return environment_section()


def with_session_context(system_prompt: str) -> str:
    """兼容旧调用：若传入的已是完整宪法，仍把 Environment 插到 Identity 之后。

    新代码请直接用 ``prompts.build_agent_system``。
    """
    from .prompts import build_agent_system, environment_section

    base = (system_prompt or "").strip()
    if not base:
        return build_agent_system(tier="medium")
    # 已含 Environment 则不再重复
    if "# Environment" in base:
        return base
    env = environment_section()
    if base.startswith("# Identity"):
        # Identity 段落后插入 Environment
        parts = base.split("\n\n", 1)
        if len(parts) == 2:
            return f"{parts[0]}\n\n{env}\n\n{parts[1]}"
    return f"{base}\n\n{env}"


def allowed_from_role(role: dict[str, Any] | None) -> list[str] | None:
    """角色勾选的工具/分组；空列表表示不限制。"""
    if not role:
        return None
    tools = role.get("tools")
    if not isinstance(tools, list) or not tools:
        return None
    return [str(t) for t in tools if str(t).strip()]


def tool_call_fingerprint(name: str, args: Any) -> str:
    """同工具 + 同参的稳定指纹（用于去重）。"""
    try:
        payload = json.dumps(args, ensure_ascii=False, sort_keys=True, default=str)
    except TypeError:
        payload = repr(args)
    return f"{name}\0{payload}"


def _tool_call_fields(tool_call: Any) -> tuple[str, Any, str]:
    if isinstance(tool_call, dict):
        return (
            str(tool_call.get("name") or ""),
            tool_call.get("args") if "args" in tool_call else {},
            str(tool_call.get("id") or ""),
        )
    return (
        str(getattr(tool_call, "name", "") or ""),
        getattr(tool_call, "args", {}) or {},
        str(getattr(tool_call, "id", "") or ""),
    )


def same_arg_tool_guard():
    """本轮 ReAct 内：同一工具 + 相同参数只允许执行一次（质量护栏，非砍轮次）。"""
    seen: set[str] = set()

    @wrap_tool_call(name="SameArgToolGuard")
    def _guard(request: Any, handler: Any) -> Any:
        name, args, call_id = _tool_call_fields(request.tool_call)
        key = tool_call_fingerprint(name, args)
        if key in seen:
            return ToolMessage(
                content=(
                    f"已拒绝重复调用：工具 `{name}` 曾以相同参数执行过。"
                    "请基于已有工具结果直接作答，或更换参数 / 换用其他工具。"
                ),
                tool_call_id=call_id,
                status="error",
            )
        seen.add(key)
        return handler(request)

    return _guard


# create_agent 一轮约「模型节点 + 工具节点」各计 1 步；middleware / 并行 tool 另占步数。
# 余量 10：对齐社区常见 create_agent 默认量级（约 25）相对「纯 2×轮次」多出的缓冲。
RECURSION_LIMIT_MARGIN = 10


def react_recursion_limit(
    max_model_calls: int,
    *,
    margin: int = RECURSION_LIMIT_MARGIN,
) -> int:
    """图 ``recursion_limit``：``2 × max_model_calls + margin``。

    须大于模型/工具 middleware 预算，否则天气这类「定位 + 搜索」会先撞图步数。
    空转由 Tool/Model call limit 收束，本值只当安全网。
    """
    calls = max(1, int(max_model_calls))
    pad = max(0, int(margin))
    return 2 * calls + pad


def build_react_graph(
    model: Any,
    tools: list[Any],
    *,
    system_prompt: str,
    name: str,
    max_model_calls: int | None = 12,
    max_tool_calls: int | None = 10,
    max_web_search: int | None = 3,
):
    """用 ``create_agent`` 得到 ReAct 编译图。

    护栏：
    - 同工具同参只执行一次
    - 工具次数对齐 LangChain 文档示例：``web_search`` run_limit=3、全体=10
    - 模型调用上限（触顶 end）；默认略高于工具上限以免先卡死
    """
    middleware: list[Any] = [same_arg_tool_guard()]
    if max_web_search is not None and max_web_search > 0:
        middleware.append(
            ToolCallLimitMiddleware(
                tool_name="web_search",
                run_limit=max_web_search,
                exit_behavior="continue",
            )
        )
    if max_tool_calls is not None and max_tool_calls > 0:
        middleware.append(
            ToolCallLimitMiddleware(
                run_limit=max_tool_calls,
                exit_behavior="continue",
            )
        )
    if max_model_calls is not None and max_model_calls > 0:
        middleware.append(
            ModelCallLimitMiddleware(
                run_limit=max_model_calls,
                exit_behavior="end",
            )
        )
    return create_agent(
        model,
        tools,
        system_prompt=system_prompt,
        name=name,
        middleware=middleware,
    )


def invoke_react(
    agent: Any,
    payload: dict[str, Any],
    *,
    recursion_limit: int,
    deadline_s: float | None = None,
    config_extra: dict[str, Any] | None = None,
) -> Any:
    """``agent.invoke``；可选墙钟超时（仅防死挂，默认不压质量）。"""
    from trace import runnable_config  # pyright: ignore[reportMissingImports]

    cfg = runnable_config({"recursion_limit": recursion_limit, **(config_extra or {})})

    def _run() -> Any:
        return agent.invoke(payload, config=cfg)

    if deadline_s is None or deadline_s <= 0:
        return _run()

    with ThreadPoolExecutor(max_workers=1) as pool:
        fut = pool.submit(_run)
        try:
            return fut.result(timeout=deadline_s)
        except FuturesTimeout as exc:
            raise TimeoutError(
                f"ReAct 超过 {int(deadline_s)}s 仍未结束（可能卡在模型或联网）"
            ) from exc


def merge_tool_traces(
    prior: list[dict[str, Any]] | None,
    new: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    """hard 核对回环时追加工具轨迹，不覆盖上一轮。"""
    out: list[dict[str, Any]] = []
    for row in list(prior or []) + list(new or []):
        if isinstance(row, dict):
            out.append(row)
    return out
