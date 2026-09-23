"""SkillHub 公开目录代理 + 本机安装。

下载链路（浏览 → 详情 → 安装）：
    1. 浏览/搜索：``GET /api/skills`` → ``list_skills()`` → ``_normalize_skill``
       代理 SkillHub 列表并做字段归一化，前端 Skill 市场直接渲染。
    2. 详情：``GET /api/v1/skills/{slug}`` + 可选 ``SKILL.md`` → ``get_skill()`` →
       ``_normalize_detail``。SKILL.md 走同一 httpx 客户端，失败时静默降级。
    3. 安装：``POST /api/skills/{slug}/install`` → ``install_from_hub()`` →
       ``local_store.install_skill()`` 把 SKILL.md + manifest.json 落到
       ``$CHATVEIN_DATA_DIR/skills/<slug>/``，同版本幂等复用。
    4. 接线：聊天时前端把已选 slug 发到 ``/api/chat``，``main.py`` 用
       ``skill_prompt_blocks()`` 拼出文本注入 role prompt（详见 local_store）。
"""

from __future__ import annotations

import os
import re
from typing import Any

import httpx

from . import local_store

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
    """输出前端筛选下拉用的分类字典（[{id, label}, ...]）。"""
    return [{"id": key, "label": label} for key, label in CATEGORY_LABELS.items()]


def _prefer_text(*candidates: Any) -> str:
    """按顺序挑选第一个非空字符串，用作字段兜底（中文优先于英文等）。"""
    for value in candidates:
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _as_dict(value: Any) -> dict[str, Any]:
    """把可能为 dict 的值安全归一为 dict（非 dict 时返回空字典）。"""
    return value if isinstance(value, dict) else {}


def _as_list(value: Any) -> list[Any]:
    """把可能为 list 的值安全归一为 list（非 list 时返回空列表）。"""
    return value if isinstance(value, list) else []


def _publisher_name(raw: dict[str, Any]) -> str:
    """从列表项里挖发布方名字：publisher → namespace → ownerName → handle。"""
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
    """当 SkillHub 返回的 homepage 缺失或指向自家 API 时，兜底成站点页 URL。"""
    if slug and (not homepage.startswith("http") or "api.skillhub.cn" in homepage):
        return f"{SKILLHUB_SITE}/skills/{slug}"
    return homepage


def _normalize_skill(raw: dict[str, Any]) -> dict[str, Any]:
    """把 SkillHub 列表接口的一条原始记录翻译成前端卡片需要的字段。"""
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
    """构造 SkillHub 请求用的 httpx 客户端（统一超时和 UA）。"""
    return httpx.Client(
        timeout=_DEFAULT_TIMEOUT,
        headers={"User-Agent": _USER_AGENT, "Accept": "application/json"},
        follow_redirects=True,
    )


def _raise_http(exc: Exception) -> None:
    """把 httpx / json 异常翻译成面向用户的中文报错（供 controller 转 HTTPException）。"""
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
    """整理第三方安全扫描结论（provider → status / statusText / reportUrl）。"""
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
    """把 SkillHub 详情接口 payload 翻译成前端抽屉需要的字段结构。"""
    skill = _as_dict(payload.get("skill"))
    slug = _prefer_text(payload.get("slug"), skill.get("slug"))
    if not slug:
        raise RuntimeError("SkillHub 详情缺少 slug")

    stats = _as_dict(skill.get("stats"))
    latest = _as_dict(payload.get("latestVersion"))
    owner = _as_dict(payload.get("owner"))
    namespace = _as_dict(payload.get("namespace"))
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
    tags = _as_dict(skill.get("tags"))
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
    raw_skills = _as_list(data.get("skills"))
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

    detail = _normalize_detail(payload, skill_md=skill_md)
    detail["installed"] = local_store.is_installed(cleaned)
    return detail


def install_from_hub(slug: str) -> dict[str, Any]:
    """拉取详情并安装到本机。返回对象里带 local 字段供前端展示落盘信息。"""
    detail = get_skill(slug)
    installed = local_store.install_skill(detail)
    detail["installed"] = True
    detail["local"] = installed
    return detail


def uninstall_local(slug: str) -> dict[str, Any]:
    """卸载本机技能：直接删掉 <data>/skills/<slug>/ 整个目录。"""
    removed = local_store.uninstall_skill(slug)
    return {"slug": slug, "removed": removed}


def list_local_skills() -> dict[str, Any]:
    """列出本机已安装技能，供聊天附件选择器渲染。"""
    rows = local_store.list_installed()
    return {"skills": rows, "total": len(rows)}


def skill_prompt_blocks(slugs: list[str] | None) -> str:
    """接线入口：把已选 slug 集合拼成"技能目录"文本，供 main.py 注入 role prompt。

    注入的是目录（name + description + slug），不是 SKILL.md 正文：
    长技能正文由模型在需要时调用 ``load_skill(slug)`` 工具按需拉取，
    避免一次性占用上下文。

    - 忽略空列表和未安装的 slug（load_skill_catalog 已经过滤）；
    - 未启用技能时返回空串；
    - ``load_skill_blocks`` / ``format_skills_for_prompt`` 全文模式仍保留，
      供测试与需要全文注入的场景使用。
    """
    catalog = local_store.load_skill_catalog(slugs)
    return local_store.format_skill_catalog_for_prompt(catalog)
