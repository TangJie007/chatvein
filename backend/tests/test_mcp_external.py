"""外部 MCP server：配置 / 凭据 / 协议客户端 / 工具接入。

真协议测试用 ``FastMCP`` 起一个子进程（stdio），走完整 initialize → list_tools →
call_tool；比 mock session 更能暴露「SDK 版本不一致」「取消作用域跨任务」这类坑。
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

from mcps.external import repository, service
from mcps.external import state as external_state
from mcps.external.client import McpError, check_url
from mcps.external.config import (
    ServerConfig,
    config_from_row,
    row_from_payload,
    split_allowlist,
    split_command,
)

pytest.importorskip("mcp")

_SERVER_SCRIPT = '''
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("mock")


@mcp.tool()
def add(a: int, b: int) -> int:
    """两数相加"""
    return a + b


@mcp.tool()
def boom() -> str:
    """总是失败"""
    raise RuntimeError("故意失败")


if __name__ == "__main__":
    mcp.run()
'''


@pytest.fixture()
def mock_server(tmp_path: Path) -> ServerConfig:
    script = tmp_path / "mock_mcp_server.py"
    script.write_text(_SERVER_SCRIPT, encoding="utf-8")
    return ServerConfig(
        id="mock",
        name="Mock",
        transport="stdio",
        command=f'"{sys.executable}" "{script}"',
        approval_mode="auto",
        timeout_s=20,
    )


@pytest.fixture()
def connection(mock_server: ServerConfig):
    from mcps.external.client import Connection

    conn = Connection(mock_server)
    conn.connect()
    yield conn
    conn.close()


# ---- 配置 / 凭据 -------------------------------------------------------


def test_split_helpers() -> None:
    assert split_allowlist(" a, b\nc ") == ("a", "b", "c")
    assert split_allowlist("") == ()
    tokens = split_command('python.exe -m "some server.py"')
    assert tokens[0].lower().endswith("python.exe")
    assert tokens[-1] == "some server.py"


def test_row_payload_encrypts_secrets() -> None:
    row = row_from_payload(
        {
            "name": "My Server",
            "transport": "stdio",
            "command": "npx -y x",
            "env": {"API_TOKEN": "s3cr3t"},
            "headers": {},
        }
    )
    assert row["id"] == "my-server"
    assert "s3cr3t" not in row["env_enc"]
    config = config_from_row(row)
    assert config.env == {"API_TOKEN": "s3cr3t"}
    # 对外报文只有键，没有值
    assert config.public()["env_keys"] == ["API_TOKEN"]
    assert "s3cr3t" not in str(config.public())


def test_service_crud_keeps_secret_when_untouched() -> None:
    created = service.create_server(
        {
            "name": "Crud",
            "transport": "stdio",
            "command": "npx -y noop",
            "env": {"TOKEN": "abc123"},
            "enabled": False,  # 不真连，避免测试里拉子进程
        }
    )
    assert created["env_keys"] == ["TOKEN"]
    raw = repository.get_row(created["id"])
    assert raw is not None and "abc123" not in raw["env_enc"]

    updated = service.update_server(created["id"], {"name": "Crud2"})
    assert updated["name"] == "Crud2"
    assert updated["env_keys"] == ["TOKEN"], "没传 env 时应保留旧凭据"

    cleared = service.update_server(created["id"], {"env": {}})
    assert cleared["env_keys"] == []

    assert service.delete_server(created["id"])["deleted"] == created["id"]
    assert repository.get_row(created["id"]) is None


def test_service_rejects_bad_url() -> None:
    created = service.create_server(
        {"name": "bad", "transport": "sse", "url": "ftp://example.com", "enabled": True}
    )
    assert created["status"]["state"] == "error"
    assert "http" in (created["status"]["error"] or "")
    service.delete_server(created["id"])


def test_check_url_blocks_metadata_host() -> None:
    assert check_url("http://169.254.169.254/latest") is not None
    assert check_url("http://127.0.0.1:7777/sse") is None


# ---- 协议客户端 --------------------------------------------------------


def test_stdio_list_and_call(connection) -> None:
    names = {spec["name"] for spec in connection.tools}
    assert {"add", "boom"} <= names

    assert connection.call_tool("add", {"a": 2, "b": 3}).strip() == "5"

    with pytest.raises(McpError):
        connection.call_tool("boom", {})


def test_adapter_wraps_tool(mock_server: ServerConfig, connection) -> None:
    from mcps.external.adapter import make_tool

    spec = next(spec for spec in connection.tools if spec["name"] == "add")
    tool = make_tool(mock_server, spec, connection)
    assert tool.name == "mcp__mock__add"
    assert "两数相加" in tool.description
    assert tool.invoke({"a": 10, "b": 5}).strip() == "15"


def test_tool_groups_merge_and_allowlist(
    monkeypatch: pytest.MonkeyPatch, mock_server: ServerConfig
) -> None:
    monkeypatch.setattr(
        external_state, "load_configs", lambda force=False: {mock_server.id: mock_server}
    )
    external_state.connect(mock_server.id)
    try:
        groups = external_state.tool_groups()
        assert list(groups) == ["mcp-ext::mock"]
        assert {tool.name for tool in groups["mcp-ext::mock"]} == {"mcp__mock__add", "mcp__mock__boom"}
        # 第二次调用命中缓存，不重建工具对象
        assert external_state.tool_groups()["mcp-ext::mock"][0] is groups["mcp-ext::mock"][0]
    finally:
        external_state.disconnect_all()
        external_state.reset()


def test_allowlist_filters_tools(
    monkeypatch: pytest.MonkeyPatch, mock_server: ServerConfig
) -> None:
    limited = ServerConfig(**{**mock_server.__dict__, "allow_tools": ("add",)})
    monkeypatch.setattr(
        external_state, "load_configs", lambda force=False: {limited.id: limited}
    )
    external_state.connect(limited.id)
    try:
        groups = external_state.tool_groups()
        assert [tool.name for tool in groups["mcp-ext::mock"]] == ["mcp__mock__add"]
    finally:
        external_state.disconnect_all()
        external_state.reset()


def test_missing_sdk_degrades(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(external_state, "sdk_available", lambda: False)
    external_state.reset()
    assert external_state.tool_groups() == {}


# ---- HTTP 接口 ---------------------------------------------------------


def test_router_crud_round_trip() -> None:
    """只挂本模块路由（不重载 main），验证路径前缀与凭据脱敏。"""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from mcps.external.module import mcp_servers_router

    app = FastAPI()
    app.include_router(mcp_servers_router)
    client = TestClient(app)

    listed = client.get("/api/mcp-servers/").json()
    assert listed["servers"] == []
    assert listed["available"] == {"enabled": True, "sdk": True}

    created = client.post(
        "/api/mcp-servers/",
        json={
            "name": "Remote",
            "transport": "sse",
            "url": "http://127.0.0.1:9/sse",
            "env": {"TOKEN": "topsecret"},
            "enabled": False,
        },
    )
    assert created.status_code == 200, created.text
    body = created.json()
    assert body["env_keys"] == ["TOKEN"]
    assert "topsecret" not in created.text

    assert client.delete(f"/api/mcp-servers/{body['id']}").status_code == 200
    assert client.get(f"/api/mcp-servers/{body['id']}").status_code == 404
