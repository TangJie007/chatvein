"""mcp-browser：探测省略分组；有 Chromium 时冒烟 navigate + snapshot。"""

from __future__ import annotations

import pytest

from mcps.browser_runtime import clear_runtime_cache, probe_browser
from mcps.registry import tool_groups
from mcps.tools import browser, refresh_tool_groups


def test_browser_probe_omits_group_when_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CHATVEIN_USE_BROWSER_TOOL", "0")
    clear_runtime_cache()
    status = probe_browser()
    assert status["available"] is False
    groups = refresh_tool_groups()
    assert "mcp-browser" not in groups


def test_browser_tools_do_not_include_run_code_unsafe() -> None:
    names = {t.name for t in browser.TOOLS}
    assert "browser_run_code_unsafe" not in names
    assert "browser_navigate" in names
    assert "browser_snapshot" in names
    assert "browser_tabs" in names
    assert len(browser.TOOLS) == 26


def test_catalog_may_include_browser_when_available() -> None:
    clear_runtime_cache()
    groups = tool_groups()
    if probe_browser().get("available"):
        assert "mcp-browser" in groups
        assert "browser_navigate" in groups["mcp-browser"]
    else:
        assert "mcp-browser" not in groups


@pytest.mark.skipif(
    not probe_browser().get("available"),
    reason="Playwright 浏览器未安装（playwright install chromium）",
)
def test_navigate_and_snapshot_include_ref(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CHATVEIN_BROWSER_HEADLESS", "1")
    clear_runtime_cache()
    from mcps import browser_session as session

    try:
        out = session.navigate("data:text/html,<html><body><button>Go</button></body></html>")
        assert "ref=" in out or "[ref=" in out
        snap = session.snapshot()
        assert "button" in snap.lower()
    finally:
        session.close_browser()
