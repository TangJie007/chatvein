"""SkillHub 公开目录代理。

浏览用 ``GET https://api.skillhub.cn/api/skills``（无需鉴权）。
详情用 ``GET https://api.skillhub.cn/api/v1/skills/{slug}``，并可选拉取 ``SKILL.md``。
安装 / 下载留到后续版本。
"""

from __future__ import annotations

import os
import re
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
    "education": "教育学习",
}

_SLUG_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$")
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


def _homepage_for(slug: str, homepage: str = "") -> str:
    if slug and (not homepage.startswith("http") or "api.skillhub.cn" in homepage):
        return f"{SKILLHUB_SITE}/skills/{slug}"
    return homepage


def _normalize_skill(raw: dict[str, Any]) -> dict[str, Any]:
    slug = _prefer_text(raw.get("slug"))
    category = _prefer_text(raw.get("category"))
    sub_names: list[str] = []
    for item in raw.get("subCategories") or []:
        if isinstance(item, dict):
            label = _prefer_text(item.get("name"))
            if label:
                sub_names.append(label)
    homepage = _homepage_for(slug, _prefer_text(raw.get("homepage")))

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


def _http_client() -> httpx.Client:
    return httpx.Client(
        timeout=_DEFAULT_TIMEOUT,
        headers={"User-Agent": _USER_AGENT, "Accept": "application/json"},
        follow_redirects=True,
    )


def _raise_http(exc: Exception) -> None:
    if isinstance(exc, httpx.TimeoutException):
        raise RuntimeError("SkillHub 请求超时，请稍后重试") from exc
    if isinstance(exc, httpx.HTTPStatusError):
        status = exc.response.status_code
        if status == 404:
            raise RuntimeError("SkillHub 未找到该技能") from exc
        raise RuntimeError(f"SkillHub 返回 HTTP {status}") from exc
    if isinstance(exc, httpx.HTTPError):
        raise RuntimeError(f"无法连接 SkillHub：{exc}") from exc
    if isinstance(exc, ValueError):
        raise RuntimeError("SkillHub 返回了无法解析的响应") from exc
    raise RuntimeError(f"SkillHub 请求失败：{exc}") from exc


def _security_reports(raw: dict[str, Any] | None) -> list[dict[str, str]]:
    if not isinstance(raw, dict):
        return []
    reports: list[dict[str, str]] = []
    for key, item in raw.items():
        if not isinstance(item, dict):
            continue
        status = _prefer_text(item.get("status"))
        status_text = _prefer_text(item.get("statusText"), status)
        report_url = _prefer_text(item.get("reportUrl"))
        if not (status or status_text or report_url):
            continue
        reports.append(
            {
                "provider": str(key),
                "status": status,
                "status_text": status_text,
                "report_url": report_url,
            }
        )
    return reports


def _normalize_detail(
    payload: dict[str, Any], *, skill_md: str | None = None
) -> dict[str, Any]:
    skill = payload.get("skill") if isinstance(payload.get("skill"), dict) else {}
    slug = _prefer_text(payload.get("slug"), skill.get("slug"))
    if not slug:
        raise RuntimeError("SkillHub 详情缺少 slug")

    stats = skill.get("stats") if isinstance(skill.get("stats"), dict) else {}
    latest = (
        payload.get("latestVersion")
        if isinstance(payload.get("latestVersion"), dict)
        else {}
    )
    owner = payload.get("owner") if isinstance(payload.get("owner"), dict) else {}
    namespace = (
        payload.get("namespace") if isinstance(payload.get("namespace"), dict) else {}
    )
    category = _prefer_text(skill.get("category"))
    sub_names: list[str] = []
    for item in skill.get("subCategories") or []:
        if isinstance(item, dict):
            label = _prefer_text(item.get("name"))
            if label:
                sub_names.append(label)

    publisher = _prefer_text(
        owner.get("displayName"),
        owner.get("handle"),
        namespace.get("displayName"),
        namespace.get("handle"),
    )
    tags = skill.get("tags") if isinstance(skill.get("tags"), dict) else {}
    version = _prefer_text(latest.get("version"), tags.get("latest"))
    updated_at = skill.get("updatedAt")
    if updated_at is None:
        updated_at = skill.get("updated_at")

    return {
        "slug": slug,
        "name": _prefer_text(skill.get("displayName"), slug),
        "description": _prefer_text(skill.get("summary_zh"), skill.get("summary")),
        "overview_md": _prefer_text(skill.get("overviewMd")),
        "skill_md": skill_md,
        "category": category,
        "category_label": CATEGORY_LABELS.get(category, category or "其他"),
        "sub_categories": sub_names,
        "downloads": int(stats.get("downloads") or 0),
        "installs": int(stats.get("installs") or 0),
        "stars": int(stats.get("stars") or 0),
        "version_count": int(stats.get("versions") or 0),
        "version": version,
        "changelog": _prefer_text(latest.get("changelog")),
        "icon_url": skill.get("iconUrl")
        if isinstance(skill.get("iconUrl"), str)
        else None,
        "homepage": _homepage_for(slug),
        "publisher": publisher,
        "source": _prefer_text(skill.get("source"), "community"),
        "verified": bool(skill.get("verified")),
        "updated_at": updated_at,
        "security_reports": _security_reports(
            payload.get("securityReports")
            if isinstance(payload.get("securityReports"), dict)
            else None
        ),
        "website": SKILLHUB_SITE,
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
        with _http_client() as client:
            response = client.get(url, params=params)
            response.raise_for_status()
            payload = response.json()
    except Exception as exc:
        _raise_http(exc)
        raise  # pragma: no cover

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


def _fetch_skill_md(client: httpx.Client, slug: str) -> str | None:
    """尽力拉取 SKILL.md；失败时不影响详情页。"""
    try:
        response = client.get(
            f"{SKILLHUB_API}/api/v1/skills/{slug}/file",
            params={"path": "SKILL.md"},
            headers={"Accept": "text/plain, */*"},
        )
        if response.status_code >= 400:
            return None
        text = response.text
        return text if text.strip() else None
    except httpx.HTTPError:
        return None


def get_skill(slug: str) -> dict[str, Any]:
    """拉取单个技能详情（含可选 SKILL.md 正文）。"""
    cleaned = (slug or "").strip()
    if not _SLUG_RE.match(cleaned):
        raise ValueError("无效的 skill slug")

    url = f"{SKILLHUB_API}/api/v1/skills/{cleaned}"
    try:
        with _http_client() as client:
            response = client.get(url)
            response.raise_for_status()
            payload = response.json()
            skill_md = _fetch_skill_md(client, cleaned)
    except Exception as exc:
        _raise_http(exc)
        raise  # pragma: no cover

    if not isinstance(payload, dict):
        raise RuntimeError("SkillHub 详情格式异常")

    return _normalize_detail(payload, skill_md=skill_md)
