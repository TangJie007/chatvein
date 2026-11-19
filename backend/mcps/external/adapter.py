"""外部 MCP 工具 → LangChain 工具。

入参模型由 server 返回的 ``inputSchema`` 现推：不落磁盘、不手写，避免「server 改了
参数、我们还在用旧 schema」这类静默失败。
"""

from __future__ import annotations

import json
from typing import Any

from langchain_core.tools import BaseTool
from pydantic import Field, create_model

from ..tool_result import MCP_SERVER_DOWN, TOOL_DENIED, TOOL_FAILED, TOOL_TIMEOUT
from .client import MCP_SERVER_DOWN as CLIENT_SERVER_DOWN
from .client import MCP_TOOL_TIMEOUT, Connection, McpError
from .config import ServerConfig

_CODE_MAP = {
    CLIENT_SERVER_DOWN: MCP_SERVER_DOWN,
    MCP_TOOL_TIMEOUT: TOOL_TIMEOUT,
}


class ExternalToolError(ValueError):
    """带 ``tool_code`` 的工具失败：``resilience`` 据此跳过重试并结构化上报。"""

    def __init__(self, message: str, *, tool_code: str = TOOL_FAILED) -> None:
        super().__init__(message)
        self.tool_code = tool_code

_PY_TYPES: dict[str, type] = {
    "string": str,
    "integer": int,
    "number": float,
    "boolean": bool,
    "array": list,
    "object": dict,
}


def _args_model(config: ServerConfig, spec: dict[str, Any]) -> type:
    schema = spec.get("input_schema") or {}
    properties = schema.get("properties") or {}
    required = set(schema.get("required") or [])
    fields: dict[str, Any] = {}
    for key, prop in properties.items():
        if not isinstance(prop, dict):
            continue
        annotation = _PY_TYPES.get(str(prop.get("type") or ""), Any)
        default = ... if key in required else prop.get("default", None)
        fields[key] = (
            annotation,
            Field(default=default, description=str(prop.get("description") or "")),
        )
    model_name = "".join(part.capitalize() for part in config.tool_name(spec["name"]).split("_"))
    return create_model(f"{model_name}Args", **fields)


def _approve(config: ServerConfig, tool: str, arguments: dict[str, Any]) -> None:
    """默认「问」：外部工具是别人写的代码，首次放行必须是人点头。"""
    if config.approval_mode != "ask":
        return
    from ..approval import request_approval  # 延迟导入：避免 approval → streaming 循环
    from ..approval_policy import mcp_tool_approval

    decision = request_approval(mcp_tool_approval(config.name, tool, arguments))
    if decision != "allow":
        raise ExternalToolError(
            "未执行：用户拒绝或确认超时。不要绕过确认重试。 ",
            tool_code=TOOL_DENIED,
        )


def make_tool(config: ServerConfig, spec: dict[str, Any], connection: Connection) -> BaseTool:
    """一个远程工具 → 一个 LangChain 工具（名字带 server 前缀）。"""
    from langchain_core.tools import StructuredTool

    tool_name = spec["name"]
    full_name = config.tool_name(tool_name)
    description = (spec.get("description") or "").strip() or f"{config.name} 提供的 {tool_name}"
    args_model = _args_model(config, spec)

    def _call(**kwargs: Any) -> str:
        arguments = {k: v for k, v in kwargs.items() if v is not None}
        _approve(config, tool_name, arguments)
        try:
            return connection.call_tool(tool_name, arguments)
        except McpError as exc:
            raise ExternalToolError(
                f"外部工具 {full_name} 调用失败：{exc}",
                tool_code=_CODE_MAP.get(exc.code, TOOL_FAILED),
            ) from exc

    return StructuredTool.from_function(
        func=_call,
        name=full_name,
        description=f"{description}\n（外部 MCP 服务：{config.name}）",
        args_schema=args_model,
    )


def describe(config: ServerConfig, spec: dict[str, Any]) -> dict[str, Any]:
    """工具清单条目（设置页展示用，不回传完整 schema）。"""
    return {
        "name": config.tool_name(spec["name"]),
        "tool": spec["name"],
        "description": (spec.get("description") or "")[:200],
        "enabled": config.allows(spec["name"]),
        "params": sorted((spec.get("input_schema") or {}).get("properties", {}).keys()),
    }


def dumps_arguments(arguments: dict[str, Any] | None) -> str:
    try:
        return json.dumps(arguments or {}, ensure_ascii=False)
    except (TypeError, ValueError):
        return "{}"


__all__ = ["describe", "dumps_arguments", "make_tool"]
