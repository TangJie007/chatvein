"""MCP / 工具注册表：内置工具目录、解析与离线启发式。"""

from __future__ import annotations

import re
from typing import Any

from langchain_core.tools import BaseTool

from .tools import ALL_TOOLS, TOOL_GROUPS, heuristic_hits

_REGISTRY: dict[str, BaseTool] = {t.name: t for t in ALL_TOOLS}


def all_tools() -> list[BaseTool]:
    return list(_REGISTRY.values())


def tool_groups() -> dict[str, list[str]]:
    """``group_id → [tool_name, ...]``，供设置页 / catalog API。"""
    return {gid: [t.name for t in tools] for gid, tools in TOOL_GROUPS.items()}


def _parameters(tool: BaseTool) -> list[dict[str, Any]]:
    """从 LangChain 工具的 JSON Schema 抽出参数，供设置页抽屉展示。"""
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
    """结构化工具目录。"""
    out: list[dict[str, Any]] = []
    for gid, tools in TOOL_GROUPS.items():
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
    picked = [_REGISTRY[n] for n in names if n in _REGISTRY]
    return picked or all_tools()


def heuristic_tool_names(message: str) -> list[str]:
    return heuristic_hits(message)


def suggest_tools_route(message: str) -> tuple[str, str]:
    """供路由 Agent 离线回落：是否应走 tools。"""
    names = heuristic_tool_names(message)
    if names:
        return "tools", f"工具启发式命中: {', '.join(names)}"
    return "direct", "工具启发式: 无需工具"


def invoke_tools(message: str, names: list[str]) -> str:
    """不经 LLM，直接执行已选工具（仅无参或不需要参的工具可离线跑）。"""
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
            elif t.name in {"get_current_time", "db_stats", "list_configured_models"}:
                result = t.invoke({})
            else:
                chunks.append(f"[{t.name}] 离线模式无法自动填参，请配置 LLM")
                continue
            chunks.append(f"[{t.name}] {result}")
        except Exception as exc:  # noqa: BLE001
            chunks.append(f"[{t.name}] 失败: {exc}")
    return "\n".join(chunks) if chunks else "未执行任何工具"
