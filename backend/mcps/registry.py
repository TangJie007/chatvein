"""MCP / 工具注册表：内置工具目录、解析与离线启发式。"""

from __future__ import annotations

import re
import time
from typing import Any

from langchain_core.tools import BaseTool

from mcps.bash_runtime import (  # pyright: ignore[reportImplicitRelativeImport]
    probe_bash,
    probe_powershell,
)
from mcps.browser_runtime import probe_browser  # pyright: ignore[reportImplicitRelativeImport]

from . import permissions
from .audit import record_event
from .resilience import execute_tool_call
from .tools import heuristic_hits, refresh_tool_groups

#: 离线启发式可无参直接调用的工具（不需要模型填参）。
_NOARG_TOOLS: frozenset[str] = frozenset(
    {
        "list_allowed_directories",
        "sqlite_tables",
        "sandbox_info",
        "bash_info",
        "powershell_info",
        "browser_info",
        "get_current_time",
        "get_system_info",
        "db_stats",
        "list_configured_models",
        "get_my_location",
    }
)


def _registry() -> dict[str, BaseTool]:
    groups = refresh_tool_groups()
    return {t.name: t for tools in groups.values() for t in tools}


def all_tools() -> list[BaseTool]:
    return list(_registry().values())


def tool_groups() -> dict[str, list[str]]:
    """``group_id → [tool_name, ...]``。未检测到的 shell / browser 分组不会出现。"""
    return {gid: [t.name for t in tools] for gid, tools in refresh_tool_groups().items()}


def shell_runtime() -> dict[str, object]:
    """设置页 / catalog：Bash、PowerShell、Browser 是否可用。"""
    return {
        "bash": probe_bash(),
        "powershell": probe_powershell(),
        "browser": probe_browser(),
    }


def _parameters(tool: BaseTool) -> list[dict[str, Any]]:
    schema_model = tool.args_schema
    if schema_model is None or not hasattr(schema_model, "model_json_schema"):
        return []
    schema = schema_model.model_json_schema()
    properties = schema.get("properties")
    if not isinstance(properties, dict):
        return []
    required = {name for name in schema.get("required") or [] if isinstance(name, str)}
    params: list[dict[str, Any]] = []
    for name, spec in properties.items():
        if not isinstance(name, str) or not isinstance(spec, dict):
            continue
        raw_type = spec.get("type", "any")
        if isinstance(raw_type, list):
            type_name = " | ".join(str(part) for part in raw_type)
        elif isinstance(raw_type, str):
            type_name = raw_type
        else:
            type_name = "any"
        item: dict[str, Any] = {
            "name": name,
            "type": type_name,
            "required": name in required,
        }
        description = spec.get("description")
        if isinstance(description, str) and description.strip():
            item["description"] = description.strip()
        if "default" in spec:
            default = spec["default"]
            if default is None or isinstance(default, (str, int, float, bool)):
                item["default"] = default
        params.append(item)
    return params


def tool_catalog() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for gid, tools in refresh_tool_groups().items():
        for t in tools:
            out.append(
                {
                    "name": t.name,
                    "description": t.description or "",
                    "group": gid,
                    "parameters": _parameters(t),
                }
            )
    return out


def tool_catalog_text() -> str:
    return "\n".join(f"- {t.name}: {t.description}" for t in all_tools())


def resolve_tools(names: list[str]) -> list[BaseTool]:
    """按名解析工具。

    - 空名单 → 空列表（表示本轮不挂工具，由模型直答）
    - 有名但无一命中 → 空列表（不再静默回落全量，避免误调用）
    """
    registry = _registry()
    if not names:
        return []
    picked = [registry[n] for n in names if n in registry]
    # 无参数条件的 deny 规则在这里就摘掉：模型连「有这个工具」都不该看到。
    return [t for t in picked if permissions.static_deny(t.name) is None]


def heuristic_tool_names(message: str) -> list[str]:
    return heuristic_hits(message)


def suggest_tools_route(message: str) -> tuple[str, str]:
    names = heuristic_tool_names(message)
    if names:
        return "tools", f"工具启发式命中: {', '.join(names)}"
    return "direct", "工具启发式: 无需工具"


def _offline_args(t: BaseTool, text: str) -> dict[str, Any] | None:
    """离线（无 LLM）时的启发式填参；``None`` 表示这个工具填不了。"""
    if t.name == "calculator":
        m = re.search(r"([\d\.\s\+\-\*\/\%\(\)]+)", text)
        return {"expression": m.group(1).strip() if m else "1+1"}
    if t.name in {"web_search", "kb_search", "kb_search_messages"}:
        return {"query": text}
    if t.name == "list_directory":
        return {"path": "."}
    if t.name in _NOARG_TOOLS:
        return {}
    return None


def invoke_tools(message: str, names: list[str]) -> str:
    """离线直调：保留旧展示格式，失败统一走韧性层（可重试 + 结构化原因）。"""
    chunks: list[str] = []
    text = (message or "").strip()
    for t in resolve_tools(names):
        args = _offline_args(t, text)
        if args is None:
            chunks.append(f"[{t.name}] 离线模式无法自动填参，请配置 LLM")
            continue
        decision = permissions.check(t.name, args)
        if decision.effect != "allow":
            # 离线没有弹窗通道：ask 也只能按拒绝处理（安全优先，绝不静默放行）。
            why = "需要人工确认" if decision.effect == "ask" else "被权限规则拒绝"
            chunks.append(f"[{t.name}] 已跳过：{why}（{decision.reason}；离线模式无审批弹窗）")
            record_event(
                "tool.deny",
                tool=t.name,
                args=args,
                result_code="TOOL_DENIED",
                decision=decision.effect,
                decision_by=decision.by,
            )
            continue
        started = time.monotonic()
        result = execute_tool_call(
            tool_name=t.name,
            call_id="",
            invoke=lambda tool=t, payload=args: tool.invoke(payload),
        )
        record_event(
            "tool.call",
            tool=t.name,
            args=args,
            result_code=result.code or ("TOOL_FAILED" if result.failed else "TOOL_OK"),
            duration_ms=int((time.monotonic() - started) * 1000),
            decision="allow",
            decision_by=decision.by,
        )
        # 失败文本自带 `[name] 失败:` 前缀，避免重复拼一次。
        chunks.append(result.content if result.failed else f"[{t.name}] {result.content}")
    return "\n".join(chunks) if chunks else "未执行任何工具"


__all__ = [
    "all_tools",
    "heuristic_tool_names",
    "invoke_tools",
    "resolve_tools",
    "shell_runtime",
    "suggest_tools_route",
    "tool_catalog",
    "tool_catalog_text",
    "tool_groups",
]
