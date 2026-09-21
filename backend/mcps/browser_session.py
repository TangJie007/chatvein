"""进程内 Playwright 会话：tabs、aria AI 快照、console/network 缓冲。

对齐 @playwright/mcp：交互靠 ``page.aria_snapshot(mode="ai")`` + ``aria-ref=eN``。
"""

from __future__ import annotations

import json
import re
import threading
import time
from pathlib import Path
from typing import Any

from mcps.browser_runtime import (  # pyright: ignore[reportImplicitRelativeImport]
    launch_kwargs,
    preferred_browser,
    probe_browser,
)
from mcps.workspace import workspace_root  # pyright: ignore[reportImplicitRelativeImport]

_MAX_CONSOLE = 500
_MAX_NETWORK = 500
_MAX_TEXT = 24_000
_lock = threading.RLock()

_pw: Any = None
_browser: Any = None
_context: Any = None
_pages: list[Any] = []
_active: int = 0
_console: list[dict[str, Any]] = []
_console_since_nav: list[dict[str, Any]] = []
_network: list[dict[str, Any]] = []
_pending_dialog: Any = None
_file_chooser: Any = None


def output_dir() -> Path:
    """截图 / 快照落盘目录：主空间下 ``browser-output``。"""
    root = workspace_root() / "browser-output"
    root.mkdir(parents=True, exist_ok=True)
    return root.resolve()


def _clip(text: str, limit: int = _MAX_TEXT) -> str:
    if len(text) <= limit:
        return text
    return text[:limit] + "\n…(已截断)"


def _ensure_started() -> None:
    global _pw, _browser, _context, _pages, _active
    if _browser is not None:
        return
    status = probe_browser()
    if not status.get("available"):
        err = status.get("error") or status.get("message") or "浏览器不可用"
        raise RuntimeError(str(err))

    from playwright.sync_api import sync_playwright

    name = preferred_browser()
    _pw = sync_playwright().start()
    if name == "firefox":
        browser_type = _pw.firefox
    elif name == "webkit":
        browser_type = _pw.webkit
    else:
        browser_type = _pw.chromium
    _browser = browser_type.launch(**launch_kwargs())
    _context = _browser.new_context(viewport={"width": 1280, "height": 720})
    _context.on("page", _on_new_page)
    page = _context.new_page()
    _attach_page(page)
    _pages = [page]
    _active = 0


def _on_new_page(page: Any) -> None:
    with _lock:
        if page not in _pages:
            _pages.append(page)
            _attach_page(page)


def _attach_page(page: Any) -> None:
    page.on("console", _on_console)
    page.on("request", _on_request)
    page.on("dialog", _on_dialog)
    page.on("filechooser", _on_file_chooser)
    page.on("close", lambda: _on_page_close(page))


def _on_console(msg: Any) -> None:
    entry = {
        "type": msg.type,
        "text": msg.text,
        "location": str(getattr(msg, "location", "") or ""),
    }
    _console.append(entry)
    _console_since_nav.append(entry)
    if len(_console) > _MAX_CONSOLE:
        del _console[: len(_console) - _MAX_CONSOLE]
    if len(_console_since_nav) > _MAX_CONSOLE:
        del _console_since_nav[: len(_console_since_nav) - _MAX_CONSOLE]


def _on_request(req: Any) -> None:
    try:
        entry = {
            "url": req.url,
            "method": req.method,
            "resource_type": req.resource_type,
            "headers": dict(req.headers),
            "post_data": req.post_data,
        }
    except Exception:  # noqa: BLE001
        return
    _network.append(entry)
    if len(_network) > _MAX_NETWORK:
        del _network[: len(_network) - _MAX_NETWORK]


def _on_dialog(dialog: Any) -> None:
    global _pending_dialog
    _pending_dialog = dialog


def _on_file_chooser(chooser: Any) -> None:
    global _file_chooser
    _file_chooser = chooser


def _on_page_close(page: Any) -> None:
    global _active
    with _lock:
        if page in _pages:
            idx = _pages.index(page)
            _pages.remove(page)
            if not _pages:
                _active = 0
            elif idx <= _active:
                _active = max(0, _active - 1)


def current_page() -> Any:
    global _active, _pages
    with _lock:
        _ensure_started()
        if not _pages:
            assert _context is not None
            page = _context.new_page()
            _attach_page(page)
            _pages.append(page)
            _active = 0
        if _active < 0 or _active >= len(_pages):
            _active = len(_pages) - 1
        return _pages[_active]


def close_browser() -> str:
    global _pw, _browser, _context, _pages, _active
    global _console, _console_since_nav, _network, _pending_dialog, _file_chooser
    with _lock:
        try:
            if _context is not None:
                _context.close()
        except Exception:  # noqa: BLE001
            pass
        try:
            if _browser is not None:
                _browser.close()
        except Exception:  # noqa: BLE001
            pass
        try:
            if _pw is not None:
                _pw.stop()
        except Exception:  # noqa: BLE001
            pass
        _pw = None
        _browser = None
        _context = None
        _pages = []
        _active = 0
        _console = []
        _console_since_nav = []
        _network = []
        _pending_dialog = None
        _file_chooser = None
    return "浏览器已关闭"


def reset_session() -> None:
    """测试用：强制关掉会话。"""
    close_browser()


def navigate(url: str) -> str:
    with _lock:
        page = current_page()
        _console_since_nav.clear()
        _network.clear()
        page.goto(url, wait_until="domcontentloaded")
        return _page_meta(page) + "\n" + snapshot()


def navigate_back() -> str:
    with _lock:
        page = current_page()
        page.go_back(wait_until="domcontentloaded")
        return _page_meta(page) + "\n" + snapshot()


def navigate_forward() -> str:
    with _lock:
        page = current_page()
        page.go_forward(wait_until="domcontentloaded")
        return _page_meta(page) + "\n" + snapshot()


def reload() -> str:
    with _lock:
        page = current_page()
        page.reload(wait_until="domcontentloaded")
        return _page_meta(page) + "\n" + snapshot()


def _page_meta(page: Any) -> str:
    try:
        title = page.title()
    except Exception:  # noqa: BLE001
        title = ""
    return f"url={page.url}\ntitle={title}"


def resolve_target(target: str) -> Any:
    """``e12`` / ``ref=e12`` / ``aria-ref=e12`` → aria-ref locator；否则当 selector。"""
    page = current_page()
    raw = (target or "").strip()
    if not raw:
        raise ValueError("target 不能为空")
    m = re.fullmatch(r"(?:aria-ref=|ref=)?([ef]\d+)", raw, flags=re.I)
    if m:
        return page.locator(f"aria-ref={m.group(1)}")
    return page.locator(raw)


def snapshot(
    *,
    target: str | None = None,
    filename: str | None = None,
    depth: int | None = None,
    boxes: bool = False,
) -> str:
    with _lock:
        page = current_page()
        kwargs: dict[str, Any] = {"mode": "ai"}
        if depth is not None:
            kwargs["depth"] = int(depth)
        if boxes:
            kwargs["boxes"] = True
        if target:
            loc = resolve_target(target)
            text = loc.aria_snapshot(**kwargs)
        else:
            text = page.aria_snapshot(**kwargs)
        text = _clip(str(text or ""))
        if filename:
            path = _safe_output_path(filename, default_ext=".md")
            path.write_text(text, encoding="utf-8")
            return f"saved={path}\n{text}"
        return text


def find_in_snapshot(*, text: str | None = None, regex: str | None = None) -> str:
    tree = snapshot()
    if bool(text) == bool(regex):
        return "请提供 text 或 regex 之一"
    lines = tree.splitlines()
    hits: list[str] = []
    if text:
        needle = text.lower()
        matcher = lambda line: needle in line.lower()  # noqa: E731
    else:
        assert regex is not None
        pattern = _compile_regex(regex)
        matcher = lambda line: pattern.search(line) is not None  # noqa: E731

    for i, line in enumerate(lines):
        if not matcher(line):
            continue
        start = max(0, i - 2)
        end = min(len(lines), i + 3)
        chunk = "\n".join(lines[start:end])
        hits.append(f"--- match @{i + 1} ---\n{chunk}")
        if len(hits) >= 20:
            break
    if not hits:
        return "无匹配"
    return _clip("\n\n".join(hits))


def _compile_regex(raw: str) -> re.Pattern[str]:
    if len(raw) >= 2 and raw.startswith("/") and raw.rfind("/") > 0:
        last = raw.rfind("/")
        body, flags_s = raw[1:last], raw[last + 1 :]
        flags = 0
        if "i" in flags_s:
            flags |= re.I
        if "m" in flags_s:
            flags |= re.M
        if "s" in flags_s:
            flags |= re.S
        return re.compile(body, flags)
    return re.compile(raw)


def click(
    target: str,
    *,
    double_click: bool = False,
    button: str = "left",
    modifiers: list[str] | None = None,
) -> str:
    with _lock:
        loc = resolve_target(target)
        opts: dict[str, Any] = {"button": button or "left"}
        if modifiers:
            opts["modifiers"] = modifiers
        if double_click:
            loc.dblclick(**opts)
        else:
            loc.click(**opts)
        return snapshot()


def hover(target: str) -> str:
    with _lock:
        resolve_target(target).hover()
        return snapshot()


def drag(start_target: str, end_target: str) -> str:
    with _lock:
        resolve_target(start_target).drag_to(resolve_target(end_target))
        return snapshot()


def drop(
    target: str,
    *,
    paths: list[str] | None = None,
    data: dict[str, str] | None = None,
) -> str:
    with _lock:
        loc = resolve_target(target)
        if paths:
            resolved = [_resolve_upload_path(p) for p in paths]
            loc.set_input_files(resolved if len(resolved) > 1 else resolved[0])
        elif data:
            loc.evaluate(
                """(el, payload) => {
                  const dt = new DataTransfer();
                  for (const [type, value] of Object.entries(payload)) {
                    dt.setData(type, String(value));
                  }
                  el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
                }""",
                data,
            )
        else:
            return "paths 与 data 至少提供一个"
        return snapshot()


def type_text(
    target: str,
    text: str,
    *,
    submit: bool = False,
    slowly: bool = False,
) -> str:
    with _lock:
        loc = resolve_target(target)
        if slowly:
            loc.click()
            loc.press_sequentially(text)
        else:
            loc.fill(text)
        if submit:
            loc.press("Enter")
        return snapshot()


def fill_form(fields: list[dict[str, Any]]) -> str:
    with _lock:
        for field in fields:
            target = str(field.get("target") or field.get("ref") or "").strip()
            if not target:
                continue
            loc = resolve_target(target)
            value = field.get("value")
            name = str(field.get("name") or field.get("type") or "textbox").lower()
            if name in {"checkbox", "radio"}:
                if value in (True, "true", "1", "on", "yes"):
                    loc.check()
                else:
                    loc.uncheck()
            elif name in {"combobox", "select", "dropdown"}:
                vals = value if isinstance(value, list) else [value]
                loc.select_option([str(v) for v in vals if v is not None])
            else:
                loc.fill("" if value is None else str(value))
        return snapshot()


def select_option(target: str, values: list[str]) -> str:
    with _lock:
        resolve_target(target).select_option(values)
        return snapshot()


def press_key(key: str) -> str:
    with _lock:
        current_page().keyboard.press(key)
        return snapshot()


def evaluate(function: str, *, target: str | None = None) -> str:
    with _lock:
        page = current_page()
        if target:
            result = resolve_target(target).evaluate(function)
        else:
            result = page.evaluate(function)
        try:
            text = json.dumps(result, ensure_ascii=False, indent=2)
        except TypeError:
            text = str(result)
        return _clip(text)


def file_upload(paths: list[str] | None = None) -> str:
    global _file_chooser
    with _lock:
        if _file_chooser is None:
            return "当前没有待处理的文件选择对话框"
        chooser = _file_chooser
        _file_chooser = None
        if not paths:
            chooser.cancel()
            return "已取消文件选择"
        resolved = [_resolve_upload_path(p) for p in paths]
        chooser.set_files(resolved if len(resolved) > 1 else resolved[0])
        return snapshot()


def handle_dialog(*, accept: bool, prompt_text: str | None = None) -> str:
    global _pending_dialog
    with _lock:
        if _pending_dialog is None:
            return "当前没有待处理的对话框"
        dialog = _pending_dialog
        _pending_dialog = None
        if accept:
            dialog.accept(prompt_text)
        else:
            dialog.dismiss()
        return snapshot()


def take_screenshot(
    *,
    target: str | None = None,
    filename: str | None = None,
    type: str | None = None,  # noqa: A002 — 对齐上游参数名
    full_page: bool = False,
    scale: str = "css",
) -> str:
    with _lock:
        page = current_page()
        ext = (type or "").lower() or "png"
        if filename and "." in Path(filename).name:
            ext = Path(filename).suffix.lstrip(".").lower() or ext
        if ext not in {"png", "jpeg", "jpg", "webp"}:
            ext = "png"
        path = _safe_output_path(filename, default_ext=f".{ext if ext != 'jpg' else 'jpeg'}")
        opts: dict[str, Any] = {
            "path": str(path),
            "type": "jpeg" if ext in {"jpg", "jpeg"} else ("webp" if ext == "webp" else "png"),
            "scale": scale if scale in {"css", "device"} else "css",
        }
        if target:
            resolve_target(target).screenshot(**opts)
        else:
            opts["full_page"] = bool(full_page)
            page.screenshot(**opts)
        return f"screenshot={path}"


def console_messages(*, level: str = "info", all: bool = False, filename: str | None = None) -> str:  # noqa: A002
    order = ["error", "warning", "info", "debug", "log"]
    want = (level or "info").lower()
    if want not in order:
        want = "info"
    allowed = set(order[: order.index(want) + 1])
    # Playwright console types: error, warning, info, log, debug, ...
    type_map = {"warning": "warning", "error": "error", "info": "info", "debug": "debug", "log": "info"}
    source = _console if all else _console_since_nav
    rows = []
    for entry in source:
        t = str(entry.get("type") or "info")
        mapped = type_map.get(t, "info")
        if mapped in allowed or t in allowed:
            rows.append(f"[{t}] {entry.get('text')}")
    text = "\n".join(rows) if rows else "(无控制台消息)"
    text = _clip(text)
    if filename:
        path = _safe_output_path(filename, default_ext=".txt")
        path.write_text(text, encoding="utf-8")
        return f"saved={path}\n{text}"
    return text


def network_requests(
    *,
    static: bool = False,
    filter: str | None = None,  # noqa: A002
    filename: str | None = None,
) -> str:
    static_types = {"image", "font", "stylesheet", "media", "script", "manifest"}
    pattern = re.compile(filter) if filter else None
    lines: list[str] = []
    for i, req in enumerate(_network, start=1):
        rtype = str(req.get("resource_type") or "")
        if not static and rtype in static_types:
            # 成功的静态资源默认跳过；简化：全部静态类型都跳过
            continue
        url = str(req.get("url") or "")
        if pattern and not pattern.search(url):
            continue
        lines.append(f"{i}. {req.get('method')} {url} ({rtype})")
    text = "\n".join(lines) if lines else "(无网络请求)"
    text = _clip(text)
    if filename:
        path = _safe_output_path(filename, default_ext=".txt")
        path.write_text(text, encoding="utf-8")
        return f"saved={path}\n{text}"
    return text


def network_request(*, index: int, part: str | None = None, filename: str | None = None) -> str:
    if index < 1 or index > len(_network):
        return f"index 超出范围（1..{len(_network)}）"
    req = _network[index - 1]
    if part:
        value = req.get(part)
        text = "" if value is None else (value if isinstance(value, str) else json.dumps(value, ensure_ascii=False))
    else:
        text = json.dumps(req, ensure_ascii=False, indent=2)
    text = _clip(str(text))
    if filename:
        path = _safe_output_path(filename, default_ext=".json")
        path.write_text(text, encoding="utf-8")
        return f"saved={path}\n{text}"
    return text


def wait_for(
    *,
    time_s: float | None = None,
    text: str | None = None,
    text_gone: str | None = None,
    target: str | None = None,
) -> str:
    with _lock:
        page = current_page()
        if time_s is not None:
            page.wait_for_timeout(int(float(time_s) * 1000))
        if text:
            page.get_by_text(text).first.wait_for(state="visible")
        if text_gone:
            page.get_by_text(text_gone).first.wait_for(state="hidden")
        if target:
            resolve_target(target).wait_for(state="visible")
        return snapshot()


def resize(width: float, height: float) -> str:
    with _lock:
        page = current_page()
        page.set_viewport_size({"width": int(width), "height": int(height)})
        return snapshot()


def tabs(*, action: str, index: int | None = None, url: str | None = None) -> str:
    global _active
    with _lock:
        _ensure_started()
        act = (action or "").strip().lower()
        if act == "list":
            lines = []
            for i, page in enumerate(_pages):
                mark = "*" if i == _active else " "
                lines.append(f"{mark} [{i}] {page.url}")
            return "\n".join(lines) if lines else "(无标签页)"
        if act == "new":
            assert _context is not None
            page = _context.new_page()
            _attach_page(page)
            _pages.append(page)
            _active = len(_pages) - 1
            if url:
                page.goto(url, wait_until="domcontentloaded")
            return tabs(action="list")
        if act == "close":
            if not _pages:
                return "(无标签页)"
            idx = _active if index is None else int(index)
            if idx < 0 or idx >= len(_pages):
                return f"index 超出范围（0..{len(_pages) - 1}）"
            page = _pages[idx]
            page.close()
            if page in _pages:
                _pages.remove(page)
            if not _pages:
                assert _context is not None
                fresh = _context.new_page()
                _attach_page(fresh)
                _pages = [fresh]
                _active = 0
            else:
                _active = min(_active, len(_pages) - 1)
            return tabs(action="list")
        if act == "select":
            if index is None:
                return "select 需要 index"
            idx = int(index)
            if idx < 0 or idx >= len(_pages):
                return f"index 超出范围（0..{len(_pages) - 1}）"
            _active = idx
            _pages[_active].bring_to_front()
            return tabs(action="list")
        return "action 应为 list / new / close / select"


def info() -> str:
    status = probe_browser()
    lines = [
        f"available={status.get('available')}",
        f"browser={status.get('browser')}",
        f"path={status.get('path')}",
    ]
    if status.get("error"):
        lines.append(f"error={status.get('error')}")
    if status.get("message"):
        lines.append(f"message={status.get('message')}")
    with _lock:
        if _browser is not None and _pages:
            page = _pages[_active] if _pages else None
            if page is not None:
                lines.append(f"url={page.url}")
                lines.append(f"tabs={len(_pages)}")
                lines.append(f"active={_active}")
        else:
            lines.append("session=closed")
    return "\n".join(lines)


def _resolve_upload_path(raw: str) -> str:
    """上传路径必须落在主空间内。"""
    path = Path(raw).expanduser()
    if not path.is_absolute():
        path = (workspace_root() / path).resolve()
    else:
        path = path.resolve()
    root = workspace_root().resolve()
    try:
        path.relative_to(root)
    except ValueError as exc:
        raise ValueError(f"上传路径越界（须在主空间内）: {path}") from exc
    if not path.is_file():
        raise FileNotFoundError(f"文件不存在: {path}")
    return str(path)


def _safe_output_path(filename: str | None, *, default_ext: str) -> Path:
    stamp = time.strftime("%Y%m%d-%H%M%S")
    name = (filename or f"page-{stamp}{default_ext}").strip()
    path = Path(name)
    if path.is_absolute():
        # 绝对路径仍限制在 output_dir 下（只用文件名）
        path = output_dir() / path.name
    else:
        path = output_dir() / path
    if not path.suffix:
        path = path.with_suffix(default_ext)
    path.parent.mkdir(parents=True, exist_ok=True)
    # 二次确认未逃出 output_dir
    resolved = path.resolve()
    try:
        resolved.relative_to(output_dir())
    except ValueError as exc:
        raise ValueError(f"输出路径越界: {resolved}") from exc
    return resolved


def save_text(filename: str, text: str, *, default_ext: str = ".txt") -> Path:
    path = _safe_output_path(filename, default_ext=default_ext)
    path.write_text(text, encoding="utf-8")
    return path


__all__ = [
    "click",
    "close_browser",
    "console_messages",
    "current_page",
    "drag",
    "drop",
    "evaluate",
    "file_upload",
    "fill_form",
    "find_in_snapshot",
    "handle_dialog",
    "hover",
    "info",
    "navigate",
    "navigate_back",
    "navigate_forward",
    "network_request",
    "network_requests",
    "output_dir",
    "press_key",
    "reload",
    "reset_session",
    "resize",
    "resolve_target",
    "save_text",
    "select_option",
    "snapshot",
    "tabs",
    "take_screenshot",
    "type_text",
    "wait_for",
]
