"""Browser 自动化：进程内 Playwright，工具名/参数对齐 @playwright/mcp Core + Tabs。

不含 ``browser_run_code_unsafe``（上游 RCE-equivalent）。浏览器未安装时不注册本分组。
"""

from __future__ import annotations

from typing import Any

from langchain_core.tools import BaseTool, tool

from mcps import browser_session as session  # pyright: ignore[reportImplicitRelativeImport]
from mcps.browser_runtime import probe_browser  # pyright: ignore[reportImplicitRelativeImport]


def _err(exc: BaseException) -> str:
    return f"浏览器操作失败: {exc}"


@tool
def browser_info() -> str:
    """查看 Playwright 浏览器是否可用，以及当前会话 URL / 标签页。"""
    try:
        return session.info()
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


@tool
def browser_navigate(url: str) -> str:
    """Navigate to a URL. 返回页面元信息与 accessibility snapshot。"""
    raw = (url or "").strip()
    if not raw:
        return "url 不能为空"
    try:
        return session.navigate(raw)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


@tool
def browser_navigate_back() -> str:
    """Go back to the previous page in the history."""
    try:
        return session.navigate_back()
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


@tool
def browser_navigate_forward() -> str:
    """Go forward in the browser history."""
    try:
        return session.navigate_forward()
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


@tool
def browser_reload() -> str:
    """Reload the current page."""
    try:
        return session.reload()
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


@tool
def browser_snapshot(
    target: str | None = None,
    filename: str | None = None,
    depth: float | None = None,
    boxes: bool = False,
) -> str:
    """Capture accessibility snapshot of the current page (better than screenshot for actions)."""
    try:
        return session.snapshot(
            target=target,
            filename=filename,
            depth=int(depth) if depth is not None else None,
            boxes=bool(boxes),
        )
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


@tool
def browser_find(text: str | None = None, regex: str | None = None) -> str:
    """Search the accessibility snapshot for text or a regular expression."""
    try:
        return session.find_in_snapshot(text=text, regex=regex)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


@tool
def browser_click(
    target: str,
    element: str | None = None,
    doubleClick: bool = False,
    button: str = "left",
    modifiers: list[str] | None = None,
) -> str:
    """Perform click on a web page. ``target`` 为 snapshot 中的 ref（如 e5）或 selector。"""
    _ = element
    try:
        return session.click(
            target,
            double_click=bool(doubleClick),
            button=button or "left",
            modifiers=modifiers,
        )
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


@tool
def browser_hover(target: str, element: str | None = None) -> str:
    """Hover over element on page."""
    _ = element
    try:
        return session.hover(target)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


@tool
def browser_drag(
    startTarget: str,
    endTarget: str,
    startElement: str | None = None,
    endElement: str | None = None,
) -> str:
    """Perform drag and drop between two elements."""
    _ = startElement, endElement
    try:
        return session.drag(startTarget, endTarget)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


@tool
def browser_drop(
    target: str,
    element: str | None = None,
    paths: list[str] | None = None,
    data: dict[str, str] | None = None,
) -> str:
    """Drop files or MIME-typed data onto an element. paths 与 data 至少提供一个。"""
    _ = element
    try:
        return session.drop(target, paths=paths, data=data)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


@tool
def browser_type(
    target: str,
    text: str,
    element: str | None = None,
    submit: bool = False,
    slowly: bool = False,
) -> str:
    """Type text into editable element."""
    _ = element
    try:
        return session.type_text(target, text, submit=bool(submit), slowly=bool(slowly))
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


@tool
def browser_fill_form(fields: list[dict[str, Any]]) -> str:
    """Fill multiple form fields. 每项含 target（ref）与 value；可选 type/name。"""
    try:
        return session.fill_form(list(fields or []))
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


@tool
def browser_select_option(
    target: str,
    values: list[str],
    element: str | None = None,
) -> str:
    """Select an option in a dropdown."""
    _ = element
    try:
        return session.select_option(target, list(values or []))
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


@tool
def browser_press_key(key: str) -> str:
    """Press a key on the keyboard (e.g. Enter, ArrowLeft, a)."""
    raw = (key or "").strip()
    if not raw:
        return "key 不能为空"
    try:
        return session.press_key(raw)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


@tool
def browser_file_upload(paths: list[str] | None = None) -> str:
    """Upload one or multiple files into the pending file chooser. 省略 paths 则取消。路径须在主空间内。"""
    try:
        return session.file_upload(paths)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


@tool
def browser_handle_dialog(accept: bool, promptText: str | None = None) -> str:
    """Handle a dialog (alert/confirm/prompt)."""
    try:
        return session.handle_dialog(accept=bool(accept), prompt_text=promptText)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


@tool
def browser_evaluate(
    function: str,
    element: str | None = None,
    target: str | None = None,
    filename: str | None = None,
) -> str:
    """Evaluate JavaScript on page or element. ``function`` 形如 ``() => ...`` 或 ``(el) => ...``。"""
    _ = element
    raw = (function or "").strip()
    if not raw:
        return "function 不能为空"
    try:
        text = session.evaluate(raw, target=target)
        if filename:
            path = session.save_text(filename, text)
            return f"saved={path}\n{text}"
        return text
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


@tool
def browser_take_screenshot(
    element: str | None = None,
    target: str | None = None,
    type: str | None = None,  # noqa: A002
    filename: str | None = None,
    fullPage: bool = False,
    scale: str = "css",
) -> str:
    """Take a screenshot. For actions use browser_snapshot, not screenshots."""
    _ = element
    try:
        return session.take_screenshot(
            target=target,
            filename=filename,
            type=type,
            full_page=bool(fullPage),
            scale=scale or "css",
        )
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


@tool
def browser_console_messages(
    level: str = "info",
    all: bool = False,  # noqa: A002
    filename: str | None = None,
) -> str:
    """Returns console messages. ``level``: error|warning|info|debug."""
    try:
        return session.console_messages(level=level or "info", all=bool(all), filename=filename)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


@tool
def browser_network_requests(
    static: bool = False,
    filter: str | None = None,  # noqa: A002
    filename: str | None = None,
) -> str:
    """List network requests since loading the page."""
    try:
        return session.network_requests(static=bool(static), filter=filter, filename=filename)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


@tool
def browser_network_request(
    index: int,
    part: str | None = None,
    filename: str | None = None,
) -> str:
    """Show details of a single network request by 1-based index from browser_network_requests."""
    try:
        return session.network_request(index=int(index), part=part, filename=filename)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


@tool
def browser_wait_for(
    time: float | None = None,  # noqa: A002
    text: str | None = None,
    textGone: str | None = None,
    target: str | None = None,
) -> str:
    """Wait for text to appear/disappear, an element, or a specified time (seconds)."""
    try:
        return session.wait_for(time_s=time, text=text, text_gone=textGone, target=target)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


@tool
def browser_resize(width: float, height: float) -> str:
    """Resize the browser viewport."""
    try:
        return session.resize(width, height)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


@tool
def browser_close() -> str:
    """Close the browser."""
    try:
        return session.close_browser()
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


@tool
def browser_tabs(
    action: str,
    index: float | None = None,
    url: str | None = None,
) -> str:
    """Manage tabs: action = list | new | close | select."""
    try:
        return session.tabs(
            action=action,
            index=int(index) if index is not None else None,
            url=url,
        )
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


TOOLS: tuple[BaseTool, ...] = (
    browser_info,
    browser_navigate,
    browser_navigate_back,
    browser_navigate_forward,
    browser_reload,
    browser_snapshot,
    browser_find,
    browser_click,
    browser_hover,
    browser_drag,
    browser_drop,
    browser_type,
    browser_fill_form,
    browser_select_option,
    browser_press_key,
    browser_file_upload,
    browser_handle_dialog,
    browser_evaluate,
    browser_take_screenshot,
    browser_console_messages,
    browser_network_requests,
    browser_network_request,
    browser_wait_for,
    browser_resize,
    browser_close,
    browser_tabs,
)


def heuristic(text: str) -> list[str]:
    names: list[str] = []
    lower = text or ""
    if any(
        k in lower
        for k in (
            "浏览器",
            "打开网页",
            "打开页面",
            "browser",
            "playwright",
            "点击按钮",
            "填表",
            "截图",
            "网页操作",
            "自动化浏览",
        )
    ):
        names.append("browser_navigate")
        names.append("browser_snapshot")
    if any(k in lower for k in ("点击", "click", "按钮")):
        names.append("browser_click")
    if any(k in lower for k in ("输入", "填写", "type", "填表")):
        names.append("browser_type")
    if "截图" in lower or "screenshot" in lower:
        names.append("browser_take_screenshot")
    return names


def available() -> bool:
    return bool(probe_browser().get("available"))
