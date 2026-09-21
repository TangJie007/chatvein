"""内置工具与工作区沙箱。不联网、不加载向量模型。"""

import json
from pathlib import Path

import pytest

from mcps.registry import tool_catalog, tool_groups
from mcps.tools.core import calculator, convert_time, get_current_time, get_system_info
from mcps.tools.sqlite_tools import sqlite_query, sqlite_tables
from mcps.workspace import resolve_in_workspace, reset_workspace, set_workspace, workspace_root


def test_calculator_evaluates_arithmetic_and_rejects_calls() -> None:
    assert calculator.invoke({"expression": "(1+2)*3"}) == "9.0"
    assert calculator.invoke({"expression": "__import__('os')"}).startswith("计算失败")


def test_time_tools_match_mcp_server_time_shape() -> None:
    raw = get_current_time.invoke({"timezone": "UTC"})
    data = json.loads(raw)
    assert data["timezone"] == "UTC"
    assert "T" in data["datetime"]
    assert "is_dst" in data

    converted = json.loads(
        convert_time.invoke(
            {
                "source_timezone": "UTC",
                "time": "12:00",
                "target_timezone": "Asia/Shanghai",
            }
        )
    )
    assert converted["source"]["timezone"] == "UTC"
    assert converted["target"]["timezone"] == "Asia/Shanghai"
    assert "time_difference" in converted


def test_system_info_reports_host() -> None:
    info = json.loads(get_system_info.invoke({}))
    assert info["os"]
    assert info["hostname"]
    assert "cpu_count" in info
    assert "workspace" in info


def test_sqlite_query_is_read_only() -> None:
    assert sqlite_query.invoke({"sql": ""}) == "sql 不能为空"
    assert sqlite_query.invoke({"sql": "DROP TABLE conversations"}) == "仅允许 SELECT 查询"
    assert sqlite_query.invoke({"sql": "SELECT name FROM sqlite_master"}).startswith("name")


def test_catalog_groups_match_settings_ids() -> None:
    groups = tool_groups()
    assert set(groups) >= {
        "core",
        "mcp-fs",
        "mcp-web",
        "mcp-sqlite",
        "mcp-kb",
        "mcp-codesandbox",
        "mcp-ip",
        "mcp-ocr",
    }
    # Bash / PowerShell 按本机探测动态挂载，不强制出现
    assert "sqlite_query" in groups["mcp-sqlite"]
    listed = sqlite_tables.invoke({})
    assert "conversations" in listed
    names = {item["name"] for item in tool_catalog() if item["group"] == "core"}
    assert {"get_current_time", "convert_time", "calculator", "get_system_info"} <= names


def test_workspace_rejects_escape_and_remembers_custom_root(tmp_path) -> None:
    chosen = tmp_path / "chosen"
    chosen.mkdir()
    view = set_workspace(str(chosen))
    assert view["custom"] is True
    assert workspace_root() == chosen.resolve()

    with pytest.raises(ValueError, match="越界"):
        resolve_in_workspace("../outside")

    inside = resolve_in_workspace("notes/a.txt")
    assert inside == (chosen / "notes" / "a.txt").resolve()

    reset = reset_workspace()
    assert reset["custom"] is False
    assert Path(str(reset["path"])) == (tmp_path / "data" / "workspace").resolve()
