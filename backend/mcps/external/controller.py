"""``/api/mcp-servers`` 控制器：外部 MCP server 配置（stdio / SSE / HTTP）。

凭据只在写入方向出现（``env`` / ``headers`` 明文进、密文落库）；响应永远只有
``env_keys`` / ``header_keys``，否则一次「导出配置」就能把 token 读出来。
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from . import service
from .service import ServerNotFound

mcp_servers_controller = APIRouter()


class McpServerPayload(BaseModel):
    """新建 / 更新共用：未传的键表示「保持原值」（凭据尤其如此）。"""

    name: str = ""
    transport: str = "stdio"
    command: str = ""
    url: str = ""
    env: dict[str, str] | None = None
    headers: dict[str, str] | None = None
    allow_tools: list[str] | str = ""
    approval_mode: str = "ask"
    enabled: bool = True
    timeout_s: float = Field(default=30, ge=5, le=300)


def _body(payload: McpServerPayload) -> dict[str, Any]:
    # 只回传用户显式给出的键：默认值不能覆盖已存的凭据 / 开关状态。
    return payload.model_dump(exclude_unset=True)


@mcp_servers_controller.get("/")
def list_servers() -> dict[str, Any]:
    """所有外部 server（含连接状态与已发现工具）。"""
    return {"servers": service.list_servers(), "available": service.available()}


@mcp_servers_controller.post("/")
def create_server(payload: McpServerPayload) -> dict[str, Any]:
    try:
        return service.create_server(_body(payload))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@mcp_servers_controller.get("/{server_id}")
def get_server(server_id: str) -> dict[str, Any]:
    try:
        return service.get_server(server_id)
    except ServerNotFound as exc:
        raise HTTPException(status_code=404, detail="server 不存在") from exc


@mcp_servers_controller.patch("/{server_id}")
def update_server(server_id: str, payload: McpServerPayload) -> dict[str, Any]:
    try:
        return service.update_server(server_id, _body(payload))
    except ServerNotFound as exc:
        raise HTTPException(status_code=404, detail="server 不存在") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@mcp_servers_controller.delete("/{server_id}")
def delete_server(server_id: str) -> dict[str, Any]:
    try:
        return service.delete_server(server_id)
    except ServerNotFound as exc:
        raise HTTPException(status_code=404, detail="server 不存在") from exc


@mcp_servers_controller.post("/{server_id}/reconnect")
def reconnect_server(server_id: str) -> dict[str, Any]:
    """连一次并重新拉工具清单（改完命令 / 装了新工具后点它）。"""
    try:
        return service.reconnect_server(server_id)
    except ServerNotFound as exc:
        raise HTTPException(status_code=404, detail="server 不存在") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@mcp_servers_controller.get("/{server_id}/tools")
def list_tools(server_id: str) -> dict[str, Any]:
    try:
        return {"tools": service.tools_of(server_id)}
    except ServerNotFound as exc:
        raise HTTPException(status_code=404, detail="server 不存在") from exc


__all__ = ["McpServerPayload", "mcp_servers_controller"]
