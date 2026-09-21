"""联网工具 — 对齐 WorkBuddy WebSearch / WebFetch。"""

from __future__ import annotations

import re

import httpx
from bs4 import BeautifulSoup
from langchain_core.tools import BaseTool, tool

_MAX_FETCH = 24_000
_TIMEOUT = 20.0


@tool
def web_search(query: str, max_results: int = 5) -> str:
    """联网搜索公开网页，返回标题 / 链接 / 摘要。用于需要最新信息的问题。"""
    q = (query or "").strip()
    if not q:
        return "query 不能为空"
    limit = max(1, min(int(max_results), 10))
    try:
        from ddgs import DDGS

        rows = list(DDGS(timeout=12).text(q, max_results=limit))
    except Exception as exc:  # noqa: BLE001
        return (
            f"搜索失败: {exc}。"
            "若本机无法访问 DuckDuckGo，可改用 web_fetch 抓取已知 URL，或配置代理。"
        )
    if not rows:
        return "无搜索结果"
    lines: list[str] = []
    for i, row in enumerate(rows, start=1):
        title = str(row.get("title") or "").strip()
        href = str(row.get("href") or row.get("link") or "").strip()
        body = str(row.get("body") or row.get("snippet") or "").strip()
        lines.append(f"{i}. {title}\n   {href}\n   {body}")
    return "\n".join(lines)


@tool
def web_fetch(url: str) -> str:
    """抓取指定 URL 的可见文本（去脚本/样式），供进一步分析。仅 http(s)。"""
    raw = (url or "").strip()
    if not re.match(r"^https?://", raw, flags=re.I):
        return "仅支持 http/https URL"
    ctype = ""
    try:
        with httpx.Client(
            follow_redirects=True,
            timeout=_TIMEOUT,
            headers={"User-Agent": "ChatVein/0.1 (+local-agent)"},
        ) as client:
            resp = client.get(raw)
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
    return f"# {raw}\n{text}"


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
            "web search",
            "google",
            "百度",
        )
    ):
        names.append("web_search")
    if any(k in text for k in ("http://", "https://", "打开网页", "抓取", "fetch", "网页内容")):
        names.append("web_fetch")
    return names
