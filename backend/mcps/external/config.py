"""外部 MCP server 配置模型：报文解析、凭据编解码、开关。

配置落主库 ``mcp_servers`` 表（见 ``db.py::_ensure_mcp_servers_table``）。
两个「可能含 token」的字段整体加密后存单列（``env_enc`` / ``headers_enc``）：
拆分密钥与值会让审计、迁移都变复杂，而它们的使用方只有本包。
"""

from __future__ import annotations

import importlib.util
import json
import os
import re
import shlex
import uuid
from dataclasses import dataclass, field
from typing import Any

from agents import config  # pyright: ignore[reportImplicitRelativeImport]
from models.crypto import decrypt_secret, encrypt_secret  # pyright: ignore[reportImplicitRelativeImport]

#: 支持的传输：stdio 拉起子进程；sse / http 连远程（http = Streamable HTTP）。
TRANSPORTS: tuple[str, ...] = ("stdio", "sse", "http")

#: 审批模式：``ask`` 每次调用前人工确认（默认，外部工具默认不信任）；``auto`` 直接执行。
APPROVAL_MODES: tuple[str, ...] = ("ask", "auto")

_DEFAULT_TIMEOUT_S = 30.0
_MAX_TIMEOUT_S = 300.0


def external_enabled() -> bool:
    """``CHATVEIN_MCP_EXTERNAL=0`` 完全不加载外部工具（内置工具不受影响）。"""
    return config.flag("CHATVEIN_MCP_EXTERNAL", True)


def sdk_available() -> bool:
    """``mcp`` SDK 是否可导入（可选依赖；缺失时只降级，不报错）。"""
    try:
        return importlib.util.find_spec("mcp") is not None
    except (ImportError, ValueError):
        return False


def split_command(command: str) -> list[str]:
    """把一行命令拆成 argv。

    Windows 路径（``C:\\Program Files\\...``）里的反斜杠在 POSIX 模式下会被当转义，
    所以 Windows 用 ``posix=False``，再手剥成对引号；拆不开时才退回按空格切。
    """
    text = (command or "").strip()
    if not text:
        return []
    try:
        tokens = shlex.split(text, posix=os.name != "nt")
    except ValueError:
        return text.split()
    if os.name == "nt":
        tokens = [
            t[1:-1] if len(t) >= 2 and t[0] == t[-1] and t[0] in {'"', "'"} else t
            for t in tokens
        ]
    return [t for t in tokens if t]


def split_allowlist(raw: str | list[str] | tuple[str, ...] | None) -> tuple[str, ...]:
    """``allow_tools``：空 → 允许全部；支持逗号 / 换行分隔。"""
    if not raw:
        return ()
    if isinstance(raw, str):
        parts = re.split(r"[,\n]", raw)
    else:
        parts = list(raw)
    return tuple(dict.fromkeys(p.strip() for p in parts if str(p).strip()))


def slug_for(name: str) -> str:
    """server id：给工具名前缀用，只能是 ``[a-z0-9_-]``。"""
    cleaned = re.sub(r"[^a-z0-9_-]+", "-", (name or "").strip().lower()).strip("-")
    return cleaned[:40] or f"mcp-{uuid.uuid4().hex[:8]}"


def decode_pairs(stored: str) -> dict[str, str]:
    plain = decrypt_secret(stored)
    if not plain:
        return {}
    try:
        data = json.loads(plain)
    except json.JSONDecodeError:
        return {}
    if not isinstance(data, dict):
        return {}
    return {str(k): str(v) for k, v in data.items() if str(k).strip()}


def encode_pairs(pairs: dict[str, str] | None) -> str:
    data = {str(k).strip(): str(v) for k, v in (pairs or {}).items() if str(k).strip()}
    if not data:
        return ""
    return encrypt_secret(json.dumps(data, ensure_ascii=False, sort_keys=True)) or ""


@dataclass(frozen=True)
class ServerConfig:
    """一个外部 MCP server 的有效配置（已解密，只在进程内流转）。"""

    id: str
    name: str
    transport: str = "stdio"
    command: str = ""
    url: str = ""
    env: dict[str, str] = field(default_factory=dict)
    headers: dict[str, str] = field(default_factory=dict)
    allow_tools: tuple[str, ...] = ()
    approval_mode: str = "ask"
    enabled: bool = True
    timeout_s: float = _DEFAULT_TIMEOUT_S

    @property
    def group_id(self) -> str:
        """工具分组 id：角色白名单按它整组放开（``mcp-ext::<server>``）。"""
        return f"mcp-ext::{self.id}"

    def tool_name(self, tool: str) -> str:
        """外部工具名统一加前缀，避免与内置工具 / 其它 server 撞名。"""
        return f"mcp__{self.id}__{tool}"

    def allows(self, tool: str) -> bool:
        return not self.allow_tools or tool in self.allow_tools

    def public(self, *, status: dict[str, Any] | None = None) -> dict[str, Any]:
        """给前端的形态：凭据只暴露「有哪些键」，值永不出后端。"""
        data: dict[str, Any] = {
            "id": self.id,
            "name": self.name,
            "transport": self.transport,
            "command": self.command,
            "url": self.url,
            "env_keys": sorted(self.env.keys()),
            "header_keys": sorted(self.headers.keys()),
            "allow_tools": list(self.allow_tools),
            "approval_mode": self.approval_mode,
            "enabled": self.enabled,
            "timeout_s": self.timeout_s,
            "group": self.group_id,
        }
        if status is not None:
            data["status"] = status
        return data


def _coerce_transport(value: object) -> str:
    text = str(value or "stdio").strip().lower()
    return text if text in TRANSPORTS else "stdio"


def _coerce_timeout(value: object) -> float:
    try:
        seconds = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return _DEFAULT_TIMEOUT_S
    return max(5.0, min(_MAX_TIMEOUT_S, seconds))


def config_from_row(row: dict[str, Any]) -> ServerConfig:
    """行 → ``ServerConfig``（解密失败按空凭据处理，不影响 server 启动）。"""
    return ServerConfig(
        id=str(row.get("id") or ""),
        name=str(row.get("name") or row.get("id") or ""),
        transport=_coerce_transport(row.get("transport")),
        command=str(row.get("command") or ""),
        url=str(row.get("url") or ""),
        env=decode_pairs(str(row.get("env_enc") or "")),
        headers=decode_pairs(str(row.get("headers_enc") or "")),
        allow_tools=split_allowlist(row.get("allow_tools")),
        approval_mode=(
            str(row.get("approval_mode") or "ask")
            if str(row.get("approval_mode") or "ask") in APPROVAL_MODES
            else "ask"
        ),
        enabled=bool(row.get("enabled", 1)),
        timeout_s=_coerce_timeout(row.get("timeout_s")),
    )


def row_from_payload(
    payload: dict[str, Any], *, fallback_id: str = ""
) -> dict[str, Any]:
    """请求体 → 可落库的行（含加密凭据）。

    ``env`` / ``headers`` 缺省（``None``）时返回空串，调用方负责「保留旧值」；
    显式传空 dict 才表示清空。
    """
    name = str(payload.get("name") or "").strip() or fallback_id or "未命名 MCP"
    return {
        "id": str(payload.get("id") or "").strip() or fallback_id or slug_for(name),
        "name": name[:128],
        "transport": _coerce_transport(payload.get("transport")),
        "command": str(payload.get("command") or "").strip(),
        "url": str(payload.get("url") or "").strip(),
        "env_enc": encode_pairs(payload.get("env")),
        "headers_enc": encode_pairs(payload.get("headers")),
        "allow_tools": ",".join(split_allowlist(payload.get("allow_tools"))),
        "approval_mode": (
            str(payload.get("approval_mode") or "ask")
            if str(payload.get("approval_mode") or "ask") in APPROVAL_MODES
            else "ask"
        ),
        "enabled": 1 if payload.get("enabled", True) else 0,
        "timeout_s": _coerce_timeout(payload.get("timeout_s")),
    }


__all__ = [
    "APPROVAL_MODES",
    "ServerConfig",
    "TRANSPORTS",
    "config_from_row",
    "external_enabled",
    "row_from_payload",
    "sdk_available",
    "slug_for",
    "split_allowlist",
    "split_command",
]
