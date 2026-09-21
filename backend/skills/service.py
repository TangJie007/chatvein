"""SkillHub 公开目录代理。

浏览用 ``GET https://api.skillhub.cn/api/skills``（无需鉴权）。
安装 / 下载留到后续版本，本模块只做列表与搜索转发。
"""

from __future__ import annotations

import os
from typing import Any

import httpx

SKILLHUB_API = os.environ.get("CHATVEIN_SKILLHUB_API", "https://api.skillhub.cn").rstrip(
    "/"
)
SKILLHUB_SITE = os.environ.get("CHATVEIN_SKILLHUB_SITE", "https://skillhub.cn").rstrip(
    "/"
)

# SkillHub 一级分类 key → 中文（接口不返回分类字典，前端筛选用）
CATEGORY_LABELS: dict[str, str] = {
    "office-efficiency": "办公效率",
    "dev-programming": "开发编程",
    "content-creation": "内容创作",
    "design-media": "设计媒体",
    "data-analysis": "数据分析",
    "knowledge-management": "知识管理",
    "ai-agent": "AI Agent",
    "professional": "专业服务",
    "life-service": "生活服务",
    "business-ops": "商业运营",
}

_DEFAULT_TIMEOUT = httpx.Timeout(20.0, connect=8.0)
_USER_AGENT = "ChatVein/0.1 (+https://github.com/chatvein; SkillHub browse)"


def category_catalog() -> list[dict[str, str]]:
    return [{"id": key, "label": label} for key, label in CATEGORY_LABELS.items()]


def _prefer_text(*candidates: Any) -> str:
    for value in candidates:
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _publisher_name(raw: dict[str, Any]) -> str:
    publisher = raw.get("publisher")
    if isinstance(publisher, dict):
        name = _prefer_text(publisher.get("name"), publisher.get("certifiedName"))
        if name:
            return name
    namespace = raw.get("namespace")
    if isinstance(namespace, dict):
        name = _prefer_text(
            namespace.get("displayName"),
            namespace.get("handle"),
            namespace.get("canonicalName"),
        )
        if name:
            return name
    return _prefer_text(raw.get("ownerName"), raw.get("claimed_user_handle"))


def _normalize_skill(raw: dict[str, Any]) -> dict[str, Any]:
    slug = _prefer_text(raw.get("slug"))
    category = _prefer_text(raw.get("category"))
    sub_names: list[str] = []
    for item in raw.get("subCategories") or []:
        if isinstance(item, dict):
            label = _prefer_text(item.get("name"))
            if label:
                sub_names.append(label)
    homepage = _prefer_text(raw.get("homepage"))
    if slug and not homepage.startswith("http"):
        homepage = f"{SKILLHUB_SITE}/skills/{slug}"
    elif slug and "api.skillhub.cn" in homepage:
        # 列表里的 homepage 常指向 api 路径，浏览页改成官网详情
        homepage = f"{SKILLHUB_SITE}/skills/{slug}"

    return {
        "slug": slug,
        "name": _prefer_text(raw.get("name"), slug),
        "description": _prefer_text(raw.get("description_zh"), raw.get("description")),
        "category": category,
        "category_label": CATEGORY_LABELS.get(category, category or "其他"),
        "sub_categories": sub_names,
        "downloads": int(raw.get("downloads") or 0),
        "installs": int(raw.get("installs") or 0),
        "stars": int(raw.get("stars") or 0),
        "version": _prefer_text(raw.get("version")),
        "icon_url": raw.get("iconUrl") if isinstance(raw.get("iconUrl"), str) else None,
        "homepage": homepage,
        "publisher": _publisher_name(raw),
        "source": _prefer_text(raw.get("source"), "community"),
        "verified": bool(raw.get("verified")),
        "updated_at": raw.get("updated_at"),
    }


def list_skills(
    *,
    page: int = 1,
    page_size: int = 24,
    keyword: str | None = None,
    category: str | None = None,
    sort_by: str = "score",
) -> dict[str, Any]:
    """拉取 SkillHub 技能列表，返回前端友好的归一化结构。"""
    page = max(1, page)
    page_size = min(max(1, page_size), 50)
    params: dict[str, str | int] = {
        "page": page,
        "pageSize": page_size,
        "sortBy": sort_by if sort_by in {"score", "downloads", "updated_at"} else "score",
    }
    if keyword and keyword.strip():
        params["keyword"] = keyword.strip()
    if category and category.strip():
        params["category"] = category.strip()

    url = f"{SKILLHUB_API}/api/skills"
    try:
        with httpx.Client(
            timeout=_DEFAULT_TIMEOUT,
            headers={"User-Agent": _USER_AGENT, "Accept": "application/json"},
            follow_redirects=True,
        ) as client:
            response = client.get(url, params=params)
            response.raise_for_status()
            payload = response.json()
    except httpx.TimeoutException as exc:
        raise RuntimeError("SkillHub 请求超时，请稍后重试") from exc
    except httpx.HTTPStatusError as exc:
        raise RuntimeError(
            f"SkillHub 返回 HTTP {exc.response.status_code}"
        ) from exc
    except httpx.HTTPError as exc:
        raise RuntimeError(f"无法连接 SkillHub：{exc}") from exc
    except ValueError as exc:
        raise RuntimeError("SkillHub 返回了无法解析的响应") from exc

    if not isinstance(payload, dict):
        raise RuntimeError("SkillHub 响应格式异常")

    code = payload.get("code")
    if code not in (0, None, "0"):
        message = _prefer_text(payload.get("message"), "SkillHub 业务错误")
        raise RuntimeError(message)

    data = payload.get("data")
    if not isinstance(data, dict):
        data = {}
    raw_skills = data.get("skills") if isinstance(data.get("skills"), list) else []
    skills = [
        _normalize_skill(item)
        for item in raw_skills
        if isinstance(item, dict) and _prefer_text(item.get("slug"))
    ]
    total = int(data.get("total") or len(skills))

    return {
        "source": "skillhub",
        "source_label": "SkillHub",
        "website": SKILLHUB_SITE,
        "skills": skills,
        "total": total,
        "page": page,
        "page_size": page_size,
        "categories": category_catalog(),
    }
