"""外部 MCP server 的增删改查 + 连接编排。

写操作后的顺序固定：**落库 → 让缓存失效 → 重连 → 回最新状态**。
反过来的话（先重连再落库）会让「用户点了保存但工具还是旧的」成为常态。
"""

from __future__ import annotations

from typing import Any

from . import repository, state
from .config import (
    ServerConfig,
    config_from_row,
    encode_pairs,
    external_enabled,
    row_from_payload,
    sdk_available,
)
from .state import tools_details


class ServerNotFound(KeyError):
    """server id 不存在（控制器翻成 404）。"""


def available() -> dict[str, bool]:
    return {"enabled": external_enabled(), "sdk": sdk_available()}


def list_servers() -> list[dict[str, Any]]:
    servers: list[dict[str, Any]] = []
    for row in repository.list_rows():
        config = config_from_row(row)
        payload = config.public(status=state.status_of(config.id))
        payload["tools"] = tools_details(config.id)
        servers.append(payload)
    return servers


def get_server(server_id: str) -> dict[str, Any]:
    row = repository.get_row(server_id)
    if row is None:
        raise ServerNotFound(server_id)
    config = config_from_row(row)
    payload = config.public(status=state.status_of(config.id))
    payload["tools"] = tools_details(config.id)
    return payload


def create_server(payload: dict[str, Any]) -> dict[str, Any]:
    row = row_from_payload(payload)
    row["id"] = _unique_id(row["id"])
    repository.insert_row(row)
    state.load_configs(force=True)
    if row["enabled"]:
        state.connect(row["id"])
    return get_server(row["id"])


def update_server(server_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    existing = repository.get_row(server_id)
    if existing is None:
        raise ServerNotFound(server_id)
    normalized = row_from_payload({**existing, **payload}, fallback_id=server_id)
    fields: dict[str, Any] = {
        "name": normalized["name"],
        "transport": normalized["transport"],
        "command": normalized["command"],
        "url": normalized["url"],
        "allow_tools": normalized["allow_tools"],
        "approval_mode": normalized["approval_mode"],
        "enabled": normalized["enabled"],
        "timeout_s": normalized["timeout_s"],
    }
    # 凭据：请求里没带这个键 = 保留原密文；显式传 {} = 清空。
    if "env" in payload:
        fields["env_enc"] = encode_pairs(payload.get("env"))
    if "headers" in payload:
        fields["headers_enc"] = encode_pairs(payload.get("headers"))
    if repository.update_row(server_id, fields) is None:
        raise ServerNotFound(server_id)
    state.load_configs(force=True)
    if fields["enabled"]:
        state.refresh(server_id)
    else:
        state.disconnect(server_id)
    return get_server(server_id)


def delete_server(server_id: str) -> dict[str, Any]:
    state.disconnect(server_id)
    if not repository.delete_row(server_id):
        raise ServerNotFound(server_id)
    state.load_configs(force=True)
    return {"deleted": server_id}


def reconnect_server(server_id: str) -> dict[str, Any]:
    config = state.config_of(server_id)
    if config is None:
        raise ServerNotFound(server_id)
    if not config.enabled:
        raise ValueError("该 server 已停用，先启用再重连")
    # 用 refresh 而不是 connect：连接自然断开（子进程退出 / 远程掉线）后
    # Connection 已 closed，直接 connect 会一直报「连接已关闭」。
    state.refresh(server_id)
    return get_server(server_id)


def tools_of(server_id: str) -> list[dict[str, Any]]:
    config: ServerConfig | None = state.config_of(server_id)
    if config is None:
        raise ServerNotFound(server_id)
    return tools_details(server_id)


def _unique_id(base: str) -> str:
    candidate = base
    index = 2
    while repository.get_row(candidate) is not None:
        candidate = f"{base}-{index}"
        index += 1
    return candidate


__all__ = [
    "ServerNotFound",
    "available",
    "create_server",
    "delete_server",
    "get_server",
    "list_servers",
    "reconnect_server",
    "tools_of",
    "update_server",
]
