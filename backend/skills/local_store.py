"""本机已安装技能：落盘 ``CHATVEIN_DATA_DIR/skills/<slug>/``。"""

from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_SLUG_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$")
_MAX_SKILL_MD = 120_000


def _data_dir() -> Path:
    raw = (os.environ.get("CHATVEIN_DATA_DIR") or "").strip()
    if raw:
        return Path(raw).expanduser()
    return Path(__file__).resolve().parents[2] / ".chatvein"


def skills_root() -> Path:
    path = _data_dir() / "skills"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _skill_dir(slug: str) -> Path:
    cleaned = (slug or "").strip()
    if not _SLUG_RE.match(cleaned):
        raise ValueError("无效的 skill slug")
    return skills_root() / cleaned


def _meta_path(slug: str) -> Path:
    return _skill_dir(slug) / "meta.json"


def _skill_md_path(slug: str) -> Path:
    return _skill_dir(slug) / "SKILL.md"


def _iso_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def is_installed(slug: str) -> bool:
    try:
        return _skill_md_path(slug).is_file()
    except ValueError:
        return False


def list_installed() -> list[dict[str, Any]]:
    root = skills_root()
    rows: list[dict[str, Any]] = []
    for child in sorted(root.iterdir(), key=lambda p: p.name.lower()):
        if not child.is_dir():
            continue
        meta_file = child / "meta.json"
        md_file = child / "SKILL.md"
        if not md_file.is_file():
            continue
        meta: dict[str, Any] = {}
        if meta_file.is_file():
            try:
                loaded = json.loads(meta_file.read_text(encoding="utf-8"))
                if isinstance(loaded, dict):
                    meta = loaded
            except (OSError, json.JSONDecodeError, UnicodeError):
                meta = {}
        slug = str(meta.get("slug") or child.name)
        rows.append(
            {
                "slug": slug,
                "name": str(meta.get("name") or slug),
                "description": str(meta.get("description") or ""),
                "version": str(meta.get("version") or ""),
                "homepage": str(meta.get("homepage") or ""),
                "installed_at": str(meta.get("installed_at") or ""),
                "path": str(child),
            }
        )
    return rows


def read_skill_md(slug: str) -> str | None:
    try:
        path = _skill_md_path(slug)
    except ValueError:
        return None
    if not path.is_file():
        return None
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return None
    return text if text.strip() else None


def install_skill(detail: dict[str, Any]) -> dict[str, Any]:
    """把 SkillHub 详情落到本机；需要 ``skill_md`` 正文。"""
    slug = str(detail.get("slug") or "").strip()
    if not _SLUG_RE.match(slug):
        raise ValueError("无效的 skill slug")
    body = str(detail.get("skill_md") or "").strip()
    if not body:
        raise RuntimeError("该技能没有可安装的 SKILL.md")
    if len(body) > _MAX_SKILL_MD:
        raise RuntimeError("SKILL.md 过大，拒绝安装")

    target = _skill_dir(slug)
    target.mkdir(parents=True, exist_ok=True)
    _skill_md_path(slug).write_text(body, encoding="utf-8", newline="\n")
    meta = {
        "slug": slug,
        "name": str(detail.get("name") or slug),
        "description": str(detail.get("description") or ""),
        "version": str(detail.get("version") or ""),
        "homepage": str(detail.get("homepage") or ""),
        "installed_at": _iso_now(),
    }
    _meta_path(slug).write_text(
        json.dumps(meta, ensure_ascii=False, indent=2),
        encoding="utf-8",
        newline="\n",
    )
    return {**meta, "path": str(target), "installed": True}


def uninstall_skill(slug: str) -> bool:
    import shutil

    try:
        target = _skill_dir(slug)
    except ValueError as exc:
        raise ValueError(str(exc)) from exc
    if not target.exists():
        return False
    shutil.rmtree(target)
    return True


def load_skill_blocks(slugs: list[str] | None) -> list[dict[str, str]]:
    """按 slug 读取已安装技能，供 Agent system 注入。"""
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for raw in slugs or []:
        slug = str(raw).strip()
        if not slug or slug in seen:
            continue
        seen.add(slug)
        body = read_skill_md(slug)
        if not body:
            continue
        meta: dict[str, Any] = {}
        meta_file = _meta_path(slug)
        if meta_file.is_file():
            try:
                loaded = json.loads(meta_file.read_text(encoding="utf-8"))
                if isinstance(loaded, dict):
                    meta = loaded
            except (OSError, json.JSONDecodeError, UnicodeError):
                meta = {}
        out.append(
            {
                "slug": slug,
                "name": str(meta.get("name") or slug),
                "body": body[:_MAX_SKILL_MD],
            }
        )
    return out


def format_skills_for_prompt(blocks: list[dict[str, str]]) -> str:
    if not blocks:
        return ""
    parts = ["【已启用技能 — 按下列说明协助用户，真正执行仍用已提供的工具】"]
    for block in blocks:
        parts.append(f"### {block['name']} (`{block['slug']}`)\n{block['body']}")
    return "\n\n".join(parts)
