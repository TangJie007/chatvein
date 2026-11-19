"""外部 server 的进程内状态：配置快照 + 连接 + 工具缓存。

三件事按重要程度排列：

1. **不能让后端起不来**：配置读失败、SDK 缺失、server 连不上，一律降级为空分组；
2. **不能在请求路径上拉起子进程**：``tool_groups()`` 只读内存缓存，连接动作全部
   发生在启动后台线程 / 用户点「重连」时；
3. **配置改动要让工具列表立刻生效**：CRUD 后调用 ``refresh()``，缓存与连接一起重建。
"""

from __future__ import annotations

import threading
from typing import Any

from langchain_core.tools import BaseTool

from . import repository
from .adapter import describe, make_tool
from .client import Connection
from .config import ServerConfig, config_from_row, external_enabled, sdk_available

_lock = threading.Lock()
_loaded = False
_configs: dict[str, ServerConfig] = {}
_connections: dict[str, Connection] = {}
#: 发现失败原因（连接成功时清空），只用于设置页 / 诊断展示。
_errors: dict[str, str] = {}
_cache: dict[str, list[BaseTool]] = {}
_started = False


# ---- 配置 -------------------------------------------------------------


def load_configs(force: bool = False) -> dict[str, ServerConfig]:
    """从主库读一次配置；``force`` 用于 CRUD 之后必须看到新值。"""
    global _loaded, _configs
    with _lock:
        if _loaded and not force:
            return dict(_configs)
    if not external_enabled() or not sdk_available():
        with _lock:
            _loaded = True
            _configs = {}
        return {}
    try:
        rows = repository.list_rows()
    except Exception:  # noqa: BLE001 - 主库还没迁移完时不能拖垮工具注册
        rows = []
    configs = {row["id"]: config_from_row(row) for row in rows if row.get("id")}
    with _lock:
        _loaded = True
        _configs = configs
    return dict(configs)


def config_of(server_id: str) -> ServerConfig | None:
    return load_configs().get(server_id)


# ---- 连接 -------------------------------------------------------------


def _connection(server_id: str) -> Connection | None:
    with _lock:
        return _connections.get(server_id)


def connect(server_id: str) -> dict[str, Any]:
    """连一条 server 并刷新工具清单（阻塞，给启动线程 / HTTP 线程用）。"""
    config = config_of(server_id)
    if config is None:
        return {"state": "missing", "error": "配置不存在", "tool_count": 0}
    problem = _validate(config)
    if problem:
        with _lock:
            _errors[server_id] = problem
            _cache.pop(server_id, None)
        return {"state": "error", "error": problem, "tool_count": 0}
    with _lock:
        conn = _connections.get(server_id)
        if conn is None or conn.config != config or conn.closed:
            stale = conn
            conn = Connection(config)
            _connections[server_id] = conn
            _cache.pop(server_id, None)
        else:
            stale = None
    if stale is not None:
        stale.close()
    try:
        conn.connect()
    except Exception as exc:  # noqa: BLE001 - 连不上是常态，不是异常路径
        message = str(exc).strip() or type(exc).__name__
        with _lock:
            _errors[server_id] = message
            _cache.pop(server_id, None)
        return {"state": "error", "error": message, "tool_count": len(conn.tools)}
    with _lock:
        _errors.pop(server_id, None)
        _cache.pop(server_id, None)
    return {"state": "connected", "error": None, "tool_count": len(conn.tools)}


def _validate(config: ServerConfig) -> str | None:
    if not config.enabled:
        return "已停用"
    if config.transport == "stdio":
        if not config.command.strip():
            return "未填写启动命令"
        return None
    from .client import check_url

    return check_url(config.url)


def disconnect(server_id: str) -> None:
    with _lock:
        conn = _connections.pop(server_id, None)
        _cache.pop(server_id, None)
    if conn is not None:
        conn.close()


def disconnect_all() -> None:
    with _lock:
        conns = list(_connections.values())
        _connections.clear()
        _cache.clear()
    for conn in conns:
        conn.close()


def startup() -> None:
    """后端启动后调用：后台线程连所有启用的 server，不阻塞 FastAPI 启动。"""
    global _started
    with _lock:
        if _started:
            return
        _started = True
    if not external_enabled() or not sdk_available():
        return

    def _run() -> None:
        for config in load_configs(force=True).values():
            if config.enabled:
                connect(config.id)

    threading.Thread(target=_run, name="chatvein-mcp-startup", daemon=True).start()


def refresh(server_id: str | None = None) -> None:
    """配置改动后重建：``None`` = 全部重连。"""
    load_configs(force=True)
    if server_id is None:
        disconnect_all()
        for config in load_configs().values():
            if config.enabled:
                connect(config.id)
        return
    disconnect(server_id)
    config = config_of(server_id)
    if config is not None and config.enabled:
        connect(server_id)


# ---- 查询 / 工具 -------------------------------------------------------


def status_of(server_id: str) -> dict[str, Any]:
    conn = _connection(server_id)
    with _lock:
        error = _errors.get(server_id)
    if conn is None:
        if error:
            return {"state": "error", "error": error, "tool_count": 0}
        return {"state": "idle", "error": None, "tool_count": 0}
    status = conn.status()
    if error and status["state"] == "idle":
        status["error"] = error
    return status


def statuses() -> dict[str, dict[str, Any]]:
    return {server_id: status_of(server_id) for server_id in load_configs()}


def tools_details(server_id: str) -> list[dict[str, Any]]:
    """设置页用：某个 server 当前发现的工具（含是否被白名单放行）。"""
    conn = _connection(server_id)
    config = config_of(server_id)
    if conn is None or config is None:
        return []
    return [describe(config, spec) for spec in conn.tools]


def tool_groups() -> dict[str, list[BaseTool]]:
    """``{group_id: [tool, ...]}``：分组 id 为 ``mcp-ext::<server>``。"""
    if not external_enabled() or not sdk_available():
        return {}
    configs = load_configs()
    if not configs:
        return {}
    groups: dict[str, list[BaseTool]] = {}
    with _lock:
        cached = dict(_cache)
    for server_id, config in configs.items():
        if not config.enabled:
            continue
        conn = _connection(server_id)
        if conn is None or not conn.connected:
            continue
        tools = cached.get(server_id)
        if tools is None:
            specs = [spec for spec in conn.tools if spec.get("name") and config.allows(spec["name"])]
            tools = [make_tool(config, spec, conn) for spec in specs]
            with _lock:
                _cache[server_id] = tools
        if tools:
            groups[config.group_id] = tools
    return groups


def reset() -> None:
    """测试用：清空状态（不关闭连接，由调用方先 ``disconnect_all``）。"""
    global _loaded, _started, _configs
    with _lock:
        _loaded = False
        _started = False
        _configs = {}
        _errors.clear()
        _cache.clear()


__all__ = [
    "config_of",
    "connect",
    "disconnect",
    "disconnect_all",
    "load_configs",
    "refresh",
    "reset",
    "startup",
    "status_of",
    "statuses",
    "tool_groups",
    "tools_details",
]
