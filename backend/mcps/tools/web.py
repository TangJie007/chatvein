"""联网工具：搜索按 Claw Search → Tavily Keyless → Firecrawl → ddgs 降级；抓取 Firecrawl → httpx。

Claw Search：OpenClaw/Claw 常用的 Parallel Search Free（``https://search.parallel.ai/mcp``），无 key。
Tavily：``X-Tavily-Access-Mode: keyless``（有 ``TAVILY_API_KEY`` 则 Bearer）。
Firecrawl：REST Keyless（有 ``FIRECRAWL_API_KEY`` 则 Bearer）。不用 firecrawl-py（无 key 构造即抛错）。
"""

from __future__ import annotations

import json
import os
import re
from typing import Any, Callable

import httpx
from bs4 import BeautifulSoup
from langchain_core.tools import BaseTool, tool

_MAX_FETCH = 24_000
_TIMEOUT = 20.0
_SEARCH_TIMEOUT = 15.0

_CLAW_MCP = (
    os.environ.get("CLAW_SEARCH_MCP_URL") or "https://search.parallel.ai/mcp"
).rstrip("/")
_TAVILY_BASE = (os.environ.get("TAVILY_API_URL") or "https://api.tavily.com").rstrip("/")
_FC_BASE = (os.environ.get("FIRECRAWL_API_URL") or "https://api.firecrawl.dev").rstrip("/")

# 各提供商本进程禁用原因（额度 / 401 / 429 等），跳过该源继续降级。
_disabled: dict[str, str] = {}


def reset_web_search_state_for_tests() -> None:
    """测试用：清空提供商禁用标记。"""
    _disabled.clear()


# 兼容旧测试名
reset_firecrawl_state_for_tests = reset_web_search_state_for_tests


def _env_key(*names: str) -> str | None:
    for name in names:
        value = (os.environ.get(name) or "").strip()
        if value:
            return value
    return None


def _disable(provider: str, reason: str) -> None:
    _disabled[provider] = reason


def _is_disabled(provider: str) -> bool:
    return provider in _disabled


def _should_disable_http(status: int, body: str) -> bool:
    if status in {401, 402, 403, 429}:
        return True
    lower = (body or "").lower()
    return any(
        k in lower
        for k in ("api key", "unauthorized", "insufficient", "credit", "quota", "rate limit")
    )


def _ua_headers(**extra: str) -> dict[str, str]:
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "ChatVein/0.1 (+local-agent)",
    }
    headers.update(extra)
    return headers


def _snippet(item: Any) -> str:
    if isinstance(item, dict):
        for key in ("description", "snippet", "content", "highlights", "summary"):
            value = item.get(key)
            if isinstance(value, list):
                joined = " ".join(str(x) for x in value if str(x).strip()).strip()
                if joined:
                    return joined
            if isinstance(value, str) and value.strip():
                return value.strip()
        excerpts = item.get("excerpts")
        if isinstance(excerpts, list):
            joined = " ".join(str(x) for x in excerpts if str(x).strip()).strip()
            if joined:
                return joined
        return ""
    return ""


def _format_hits(rows: list[tuple[str, str, str]]) -> str:
    lines: list[str] = []
    for i, (title, href, body) in enumerate(rows, start=1):
        lines.append(f"{i}. {title}\n   {href}\n   {body}")
    return "\n".join(lines)


def _rows_to_result(source: str, rows: list[tuple[str, str, str]]) -> str | None:
    if not rows:
        return None
    return f"source={source}\n" + _format_hits(rows)


# ── Claw Search（Parallel Search Free MCP）──────────────────────────────────


def _search_claw(query: str, limit: int) -> str | None:
    """Claw/OpenClaw 常用的 Parallel Search Free（MCP），无需 API key。"""
    if _is_disabled("claw"):
        return None
    headers = _ua_headers(Accept="application/json, text/event-stream")
    init_payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "chatvein", "version": "0.1"},
        },
    }
    try:
        with httpx.Client(timeout=_SEARCH_TIMEOUT) as client:
            init = client.post(_CLAW_MCP, headers=headers, json=init_payload)
            if init.status_code >= 400:
                if _should_disable_http(init.status_code, init.text):
                    _disable("claw", f"HTTP {init.status_code}")
                return None
            session = init.headers.get("mcp-session-id") or init.headers.get("Mcp-Session-Id")
            call_headers = dict(headers)
            if session:
                call_headers["mcp-session-id"] = session
            call_payload = {
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {
                    "name": "web_search",
                    "arguments": {
                        "objective": query,
                        "search_queries": [query],
                        "count": limit,
                    },
                },
            }
            resp = client.post(_CLAW_MCP, headers=call_headers, json=call_payload)
    except Exception:  # noqa: BLE001
        return None

    if resp.status_code >= 400:
        if _should_disable_http(resp.status_code, resp.text):
            _disable("claw", f"HTTP {resp.status_code}")
        return None

    try:
        envelope = resp.json()
    except Exception:  # noqa: BLE001
        return None
    if not isinstance(envelope, dict):
        return None
    if envelope.get("error"):
        err = envelope["error"]
        msg = str(err.get("message") if isinstance(err, dict) else err)
        if _should_disable_http(0, msg):
            _disable("claw", msg)
        return None

    result = envelope.get("result") or {}
    content = result.get("content") if isinstance(result, dict) else None
    text_blob = ""
    if isinstance(content, list):
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                text_blob += str(block.get("text") or "")
    if not text_blob.strip():
        return None

    try:
        parsed = json.loads(text_blob)
    except json.JSONDecodeError:
        # 非 JSON 时仍可作为摘要返回
        return f"source=claw-search\n{text_blob.strip()[:_MAX_FETCH]}"

    items = []
    if isinstance(parsed, dict):
        items = list(parsed.get("results") or parsed.get("web") or [])
    elif isinstance(parsed, list):
        items = parsed

    rows: list[tuple[str, str, str]] = []
    for item in items[:limit]:
        if not isinstance(item, dict):
            continue
        href = str(item.get("url") or "").strip()
        title = str(item.get("title") or "").strip() or href
        if href:
            rows.append((title, href, _snippet(item)))
    return _rows_to_result("claw-search", rows)


# ── Tavily Keyless ───────────────────────────────────────────────────────────


def _search_tavily(query: str, limit: int) -> str | None:
    if _is_disabled("tavily"):
        return None
    key = _env_key("TAVILY_API_KEY")
    headers = _ua_headers()
    if key:
        headers["Authorization"] = f"Bearer {key}"
        source = "tavily"
    else:
        headers["X-Tavily-Access-Mode"] = "keyless"
        source = "tavily-keyless"

    try:
        with httpx.Client(timeout=_SEARCH_TIMEOUT) as client:
            resp = client.post(
                f"{_TAVILY_BASE}/search",
                headers=headers,
                json={"query": query, "max_results": limit},
            )
    except Exception:  # noqa: BLE001
        return None

    if resp.status_code >= 400:
        if _should_disable_http(resp.status_code, resp.text):
            _disable("tavily", f"HTTP {resp.status_code}: {resp.text[:200]}")
        return None

    try:
        data = resp.json()
    except Exception:  # noqa: BLE001
        return None
    if not isinstance(data, dict):
        return None

    rows: list[tuple[str, str, str]] = []
    for item in list(data.get("results") or [])[:limit]:
        if not isinstance(item, dict):
            continue
        href = str(item.get("url") or "").strip()
        title = str(item.get("title") or "").strip() or href
        if href:
            rows.append((title, href, _snippet(item)))
    return _rows_to_result(source, rows)


# ── Firecrawl Keyless / keyed ────────────────────────────────────────────────


def _fc_headers() -> dict[str, str]:
    headers = _ua_headers()
    key = _env_key("FIRECRAWL_API_KEY")
    if key:
        headers["Authorization"] = f"Bearer {key}"
    return headers


def _fc_post(path: str, payload: dict[str, Any]) -> dict[str, Any] | None:
    if _is_disabled("firecrawl"):
        return None
    try:
        with httpx.Client(timeout=_SEARCH_TIMEOUT) as client:
            resp = client.post(f"{_FC_BASE}{path}", headers=_fc_headers(), json=payload)
    except Exception:  # noqa: BLE001
        return None

    if resp.status_code >= 400:
        if _should_disable_http(resp.status_code, resp.text):
            _disable("firecrawl", f"HTTP {resp.status_code}: {resp.text[:200]}")
        return None

    try:
        data = resp.json()
    except Exception:  # noqa: BLE001
        return None
    if not isinstance(data, dict):
        return None
    if data.get("success") is False:
        err = str(data.get("error") or data.get("message") or "firecrawl failed")
        if _should_disable_http(0, err):
            _disable("firecrawl", err)
        return None
    return data


def _search_firecrawl(query: str, limit: int) -> str | None:
    data = _fc_post("/v2/search", {"query": query, "limit": limit})
    if data is None:
        return None
    payload = data.get("data") if isinstance(data.get("data"), dict) else data
    web = list((payload or {}).get("web") or [])
    rows: list[tuple[str, str, str]] = []
    for item in web[:limit]:
        if not isinstance(item, dict):
            continue
        href = str(item.get("url") or "").strip()
        title = str(item.get("title") or "").strip() or href
        if href:
            rows.append((title, href, _snippet(item)))
    source = "firecrawl" if _env_key("FIRECRAWL_API_KEY") else "firecrawl-keyless"
    return _rows_to_result(source, rows)


def _search_ddgs(query: str, limit: int) -> str:
    try:
        from ddgs import DDGS

        raw = list(DDGS(timeout=12).text(query, max_results=limit))
    except Exception as exc:  # noqa: BLE001
        return f"搜索失败: {exc}"
    if not raw:
        return "无搜索结果"
    rows: list[tuple[str, str, str]] = []
    for row in raw:
        title = str(row.get("title") or "").strip()
        href = str(row.get("href") or row.get("link") or "").strip()
        body = str(row.get("body") or row.get("snippet") or "").strip()
        rows.append((title, href, body))
    note = "source=ddgs"
    if _disabled:
        skipped = ", ".join(sorted(_disabled))
        note += f"（已跳过: {skipped}）"
    return note + "\n" + _format_hits(rows)


def _iter_search_providers() -> tuple[Callable[[str, int], str | None], ...]:
    """运行时取链（Claw → Tavily → Firecrawl），便于测试 mock。"""
    return (_search_claw, _search_tavily, _search_firecrawl)


def _fetch_firecrawl(url: str) -> str | None:
    data = _fc_post("/v2/scrape", {"url": url, "formats": ["markdown"]})
    if data is None:
        return None
    payload = data.get("data") if isinstance(data.get("data"), dict) else data
    text = str((payload or {}).get("markdown") or "").strip()
    if not text:
        return None
    if len(text) > _MAX_FETCH:
        text = text[:_MAX_FETCH] + "\n…(已截断)"
    mode = "firecrawl" if _env_key("FIRECRAWL_API_KEY") else "firecrawl-keyless"
    return f"# {url}\nsource={mode}\n{text}"


def _fetch_httpx(url: str) -> str:
    ctype = ""
    try:
        with httpx.Client(
            follow_redirects=True,
            timeout=_TIMEOUT,
            headers={"User-Agent": "ChatVein/0.1 (+local-agent)"},
        ) as client:
            resp = client.get(url)
            resp.raise_for_status()
            ctype = (resp.headers.get("content-type") or "").lower()
            if "html" not in ctype and "text" not in ctype and "json" not in ctype:
                return f"不支持的内容类型: {ctype or 'unknown'}"
            body = resp.text
    except Exception as exc:  # noqa: BLE001
        return f"抓取失败: {exc}"

    if "json" in ctype or body.lstrip().startswith(("{", "[")):
        text = body
    else:
        soup = BeautifulSoup(body, "lxml")
        for tag in soup(["script", "style", "noscript", "svg"]):
            tag.decompose()
        text = soup.get_text("\n", strip=True)

    text = re.sub(r"\n{3,}", "\n\n", text)
    if len(text) > _MAX_FETCH:
        text = text[:_MAX_FETCH] + "\n…(已截断)"
    note = "source=httpx"
    if "firecrawl" in _disabled:
        note += "（Firecrawl 不可用，已降级）"
    return f"# {url}\n{note}\n{text}"


@tool
def web_search(query: str, max_results: int = 5) -> str:
    """联网搜索。顺序：Claw Search → Tavily Keyless → Firecrawl → DuckDuckGo。"""
    q = (query or "").strip()
    if not q:
        return "query 不能为空"
    limit = max(1, min(int(max_results), 10))
    for search in _iter_search_providers():
        out = search(q, limit)
        if out:
            return out
    return _search_ddgs(q, limit)


@tool
def web_fetch(url: str) -> str:
    """抓取指定 URL 的正文。优先 Firecrawl Markdown（可无 key），失败时用 httpx。仅 http(s)。"""
    raw = (url or "").strip()
    if not re.match(r"^https?://", raw, flags=re.I):
        return "仅支持 http/https URL"
    return _fetch_firecrawl(raw) or _fetch_httpx(raw)


TOOLS: tuple[BaseTool, ...] = (web_search, web_fetch)


def heuristic(text: str) -> list[str]:
    names: list[str] = []
    if any(
        k in text
        for k in (
            "搜索",
            "搜一下",
            "联网",
            "网上",
            "最新",
            "查一下",
            "天气",
            "气温",
            "forecast",
            "weather",
            "web search",
            "google",
            "百度",
        )
    ):
        names.append("web_search")
    if any(k in text for k in ("http://", "https://", "打开网页", "抓取", "fetch", "网页内容")):
        names.append("web_fetch")
    return names
