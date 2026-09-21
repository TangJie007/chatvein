"""内置工具与工作区沙箱。不联网、不加载向量模型。"""

from pathlib import Path

import pytest

from mcps.registry import tool_catalog, tool_groups
from mcps.tools.core import calculator
from mcps.tools.sqlite_tools import sqlite_query, sqlite_tables
from mcps.workspace import resolve_in_workspace, reset_workspace, set_workspace, workspace_root


def test_calculator_evaluates_arithmetic_and_rejects_calls() -> None:
    assert calculator.invoke({"expression": "(1+2)*3"}) == "9.0"
    assert calculator.invoke({"expression": "__import__('os')"}).startswith("计算失败")


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
        "mcp-bash",
    }
    assert "sqlite_query" in groups["mcp-sqlite"]
    listed = sqlite_tables.invoke({})
    assert "conversations" in listed
    names = {item["name"] for item in tool_catalog() if item["group"] == "core"}
    assert "calculator" in names


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
