"""MCP / 工具注册表：内置工具目录、解析与离线启发式。"""

from __future__ import annotations

import re
from typing import Any

from langchain_core.tools import BaseTool

from mcps.bash_runtime import (  # pyright: ignore[reportImplicitRelativeImport]
    probe_bash,
    probe_powershell,
)

from .tools import heuristic_hits, refresh_tool_groups


def _registry() -> dict[str, BaseTool]:
    groups = refresh_tool_groups()
    return {t.name: t for tools in groups.values() for t in tools}


def all_tools() -> list[BaseTool]:
    return list(_registry().values())


def tool_groups() -> dict[str, list[str]]:
    """``group_id → [tool_name, ...]``。未检测到的 shell 分组不会出现。"""
    return {gid: [t.name for t in tools] for gid, tools in refresh_tool_groups().items()}


def shell_runtime() -> dict[str, object]:
    """设置页 / catalog：Bash 与 PowerShell 是否可用。"""
    return {"bash": probe_bash(), "powershell": probe_powershell()}


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
    registry = _registry()
    picked = [registry[n] for n in names if n in registry]
    return picked or list(registry.values())


def heuristic_tool_names(message: str) -> list[str]:
    return heuristic_hits(message)


def suggest_tools_route(message: str) -> tuple[str, str]:
    names = heuristic_tool_names(message)
    if names:
        return "tools", f"工具启发式命中: {', '.join(names)}"
    return "direct", "工具启发式: 无需工具"


def invoke_tools(message: str, names: list[str]) -> str:
    chunks: list[str] = []
    text = (message or "").strip()
    for t in resolve_tools(names):
        try:
            result: Any
            if t.name == "calculator":
                m = re.search(r"([\d\.\s\+\-\*\/\%\(\)]+)", text)
                expr = m.group(1).strip() if m else "1+1"
                result = t.invoke({"expression": expr})
            elif t.name == "web_search":
                result = t.invoke({"query": text})
            elif t.name == "kb_search":
                result = t.invoke({"query": text})
            elif t.name == "kb_search_messages":
                result = t.invoke({"query": text})
            elif t.name == "list_directory":
                result = t.invoke({"path": "."})
            elif t.name == "list_allowed_directories":
                result = t.invoke({})
            elif t.name == "sqlite_tables":
                result = t.invoke({})
            elif t.name in {"sandbox_info", "bash_info", "powershell_info"}:
                result = t.invoke({})
            elif t.name in {
                "get_current_time",
                "get_system_info",
                "db_stats",
                "list_configured_models",
            }:
                result = t.invoke({})
            else:
                chunks.append(f"[{t.name}] 离线模式无法自动填参，请配置 LLM")
                continue
            chunks.append(f"[{t.name}] {result}")
        except Exception as exc:  # noqa: BLE001
            chunks.append(f"[{t.name}] 失败: {exc}")
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
