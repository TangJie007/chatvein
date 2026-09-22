"""图节点共用：抽文本、角色白名单、ReAct 工厂、轨迹合并。"""

from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FuturesTimeout
from typing import Any

from langchain.agents import create_agent
from langchain.agents.middleware import wrap_tool_call
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


def build_react_graph(model: Any, tools: list[Any], *, system_prompt: str, name: str):
    """用 ``create_agent`` 得到 ReAct 编译图；仅挂同参去重，不人为砍轮次。"""
    return create_agent(
        model,
        tools,
        system_prompt=system_prompt,
        name=name,
        middleware=[same_arg_tool_guard()],
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
