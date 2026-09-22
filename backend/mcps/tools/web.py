"""联网工具：Firecrawl 优先，额度用尽或失败时降级到 ddgs / httpx+bs4。"""

from __future__ import annotations

import os
import re
from typing import Any

import httpx
from bs4 import BeautifulSoup
from langchain_core.tools import BaseTool, tool

_MAX_FETCH = 24_000
_TIMEOUT = 20.0
# Firecrawl SDK 的 timeout 单位是毫秒；短一点，失败后尽快降级。
_FC_TIMEOUT_MS = 15_000

_client: Any = None
# 额度用尽或密钥无效时本进程不再打 Firecrawl。
_disabled_reason: str | None = None


def _api_key() -> str | None:
    return (os.environ.get("FIRECRAWL_API_KEY") or "").strip() or None


def _client_or_none() -> Any:
    global _client
    if _disabled_reason is not None:
        return None
    if _client is None:
        from firecrawl import Firecrawl

        key = _api_key()
        _client = Firecrawl(api_key=key) if key else Firecrawl()
    return _client


def _disable_if_terminal(exc: BaseException) -> None:
    """402 额度耗尽、401 密钥无效：后续请求直接走降级。"""
    global _disabled_reason
    from firecrawl.v2.utils.error_handler import PaymentRequiredError, UnauthorizedError

    if isinstance(exc, (PaymentRequiredError, UnauthorizedError)):
        _disabled_reason = str(exc)
        return
    code = str(getattr(exc, "code", "") or "")
    if code in {"insufficient_credits", "billing_unavailable"}:
        _disabled_reason = str(exc)


def _snippet(item: Any) -> str:
    for attr in ("description", "snippet", "highlights", "summary"):
        value = getattr(item, attr, None)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _format_hits(rows: list[tuple[str, str, str]]) -> str:
    lines: list[str] = []
    for i, (title, href, body) in enumerate(rows, start=1):
        lines.append(f"{i}. {title}\n   {href}\n   {body}")
    return "\n".join(lines)


def _search_firecrawl(query: str, limit: int) -> str | None:
    client = _client_or_none()
    if client is None:
        return None
    try:
        data = client.search(query, limit=limit, timeout=_FC_TIMEOUT_MS)
    except Exception as exc:  # noqa: BLE001 — 任何失败都降级
        _disable_if_terminal(exc)
        return None
    web = list(getattr(data, "web", None) or [])
    rows: list[tuple[str, str, str]] = []
    for item in web:
        href = str(getattr(item, "url", "") or "").strip()
        title = str(getattr(item, "title", "") or "").strip() or href
        if href:
            rows.append((title, href, _snippet(item)))
    if not rows:
        return None
    return "source=firecrawl\n" + _format_hits(rows)


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
    if _disabled_reason:
        note += "（Firecrawl 额度或密钥不可用，已降级）"
    return note + "\n" + _format_hits(rows)


def _fetch_firecrawl(url: str) -> str | None:
    client = _client_or_none()
    if client is None:
        return None
    try:
        doc = client.scrape(url, formats=["markdown"], timeout=_FC_TIMEOUT_MS)
    except Exception as exc:  # noqa: BLE001
        _disable_if_terminal(exc)
        return None
    text = str(getattr(doc, "markdown", None) or "").strip()
    if not text:
        return None
    if len(text) > _MAX_FETCH:
        text = text[:_MAX_FETCH] + "\n…(已截断)"
    return f"# {url}\nsource=firecrawl\n{text}"


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
    if _disabled_reason:
        note += "（Firecrawl 额度或密钥不可用，已降级）"
    return f"# {url}\n{note}\n{text}"


@tool
def web_search(query: str, max_results: int = 5) -> str:
    """联网搜索公开网页，返回标题 / 链接 / 摘要。优先 Firecrawl，失败时用 DuckDuckGo。"""
    q = (query or "").strip()
    if not q:
        return "query 不能为空"
    limit = max(1, min(int(max_results), 10))
    return _search_firecrawl(q, limit) or _search_ddgs(q, limit)


@tool
def web_fetch(url: str) -> str:
    """抓取指定 URL 的正文。优先 Firecrawl（Markdown），失败时用 httpx 抽取可见文本。仅 http(s)。"""
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
