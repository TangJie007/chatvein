"""Playwright 浏览器探测：Python 包与本机浏览器二进制均需可用。

- 不随包装 Chromium；用户需 ``playwright install chromium``（或对应浏览器）。
- ``CHATVEIN_BROWSER``：chrome / chromium / firefox / webkit / msedge（默认 chromium）。
- ``CHATVEIN_BROWSER_EXECUTABLE``：显式可执行文件路径。
- ``CHATVEIN_BROWSER_HEADLESS=1``：无头模式（默认 headed，对齐 @playwright/mcp）。
- ``CHATVEIN_USE_BROWSER_TOOL=0``：关闭浏览器工具分组。
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path


_BROWSER_ALIASES = {
    "chrome": "chromium",
    "chromium": "chromium",
    "firefox": "firefox",
    "webkit": "webkit",
    "msedge": "msedge",
}


def browser_available() -> bool:
    return bool(probe_browser().get("available"))


def preferred_browser() -> str:
    raw = (os.environ.get("CHATVEIN_BROWSER") or "chromium").strip().lower()
    return _BROWSER_ALIASES.get(raw, "chromium")


def headless() -> bool:
    return (os.environ.get("CHATVEIN_BROWSER_HEADLESS") or "").strip() == "1"


def executable_path() -> Path | None:
    raw = (os.environ.get("CHATVEIN_BROWSER_EXECUTABLE") or "").strip()
    if not raw:
        return None
    path = Path(raw).expanduser()
    return path if path.is_file() else None


def probe_browser() -> dict[str, object]:
    """``{available, browser, path?, error?, message?}``。供注册表与设置页。"""
    return dict(_probe_browser_cached(_env_fingerprint()))


def clear_runtime_cache() -> None:
    _probe_browser_cached.cache_clear()


def _env_fingerprint() -> tuple[str, ...]:
    return (
        (os.environ.get("CHATVEIN_BROWSER") or "").strip(),
        (os.environ.get("CHATVEIN_BROWSER_EXECUTABLE") or "").strip(),
        (os.environ.get("CHATVEIN_BROWSER_HEADLESS") or "").strip(),
        (os.environ.get("CHATVEIN_USE_BROWSER_TOOL") or "").strip(),
        (os.environ.get("PATH") or "").strip(),
    )


@lru_cache(maxsize=8)
def _probe_browser_cached(_fingerprint: tuple[str, ...]) -> dict[str, object]:
    if (os.environ.get("CHATVEIN_USE_BROWSER_TOOL") or "").strip() == "0":
        return {
            "available": False,
            "browser": preferred_browser(),
            "path": None,
            "message": "已用 CHATVEIN_USE_BROWSER_TOOL=0 关闭",
        }

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return {
            "available": False,
            "browser": preferred_browser(),
            "path": None,
            "error": "未安装 playwright 包；请 pip install playwright 后执行 playwright install chromium",
        }

    name = preferred_browser()
    explicit = executable_path()
    if explicit is not None:
        return {
            "available": True,
            "browser": name,
            "path": str(explicit.resolve()),
        }

    try:
        with sync_playwright() as pw:
            browser_type = _browser_type(pw, name)
            exe = getattr(browser_type, "executable_path", None)
            path = str(exe) if exe else None
            if path and Path(path).is_file():
                return {"available": True, "browser": name, "path": path}
            # executable_path 可能在未 install 时仍返回预期路径；再试一次 launch 探测。
            try:
                browser = browser_type.launch(headless=True)
                browser.close()
            except Exception as exc:  # noqa: BLE001
                return {
                    "available": False,
                    "browser": name,
                    "path": path,
                    "error": (
                        f"未找到 {name} 浏览器二进制（{exc}）。"
                        f"请执行: playwright install {name if name != 'msedge' else 'chromium'}"
                    ),
                }
            return {"available": True, "browser": name, "path": path}
    except Exception as exc:  # noqa: BLE001
        return {
            "available": False,
            "browser": name,
            "path": None,
            "error": f"Playwright 探测失败: {exc}",
        }


def _browser_type(pw: object, name: str) -> object:
    if name == "firefox":
        return pw.firefox  # type: ignore[attr-defined]
    if name == "webkit":
        return pw.webkit  # type: ignore[attr-defined]
    # chrome / chromium / msedge 均走 chromium 通道
    return pw.chromium  # type: ignore[attr-defined]


def launch_kwargs() -> dict[str, object]:
    """传给 ``browser_type.launch`` 的参数。"""
    kwargs: dict[str, object] = {"headless": headless()}
    name = preferred_browser()
    if name == "msedge":
        kwargs["channel"] = "msedge"
    elif name == "chrome":
        kwargs["channel"] = "chrome"
    exe = executable_path()
    if exe is not None:
        kwargs["executable_path"] = str(exe.resolve())
    return kwargs


__all__ = [
    "browser_available",
    "clear_runtime_cache",
    "executable_path",
    "headless",
    "launch_kwargs",
    "preferred_browser",
    "probe_browser",
]
