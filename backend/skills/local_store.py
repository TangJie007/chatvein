"""本机已安装技能：落盘 ``CHATVEIN_DATA_DIR/skills/<slug>/``。

数据模型：每个技能一个目录，包含 ``SKILL.md``（正文）+ ``meta.json``（元数据）。

注入策略（目录 + 按需加载）：
- system prompt 只注入技能目录（:func:`load_skill_catalog` /
  :func:`format_skill_catalog_for_prompt`：name + description + slug），
  避免几千米的 SKILL.md 一次性挤爆上下文；
- 模型认为需要时调用 ``load_skill(slug)`` 工具（``mcps.tools.skills``）
  把完整正文拉进上下文再执行；
- 真正的动作仍走已注册的 MCP 工具，不在此处。
"""

from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# slug 白名单：首字符必须是字母或数字，后续允许 [a-zA-Z0-9._-]，长度 ≤128。
# 目的是防止 ../、绝对路径、控制字符等越界写入 skills 根目录。
_SLUG_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$")

# 单个 SKILL.md 的大小上限（字符数）。
# 超限直接拒绝：既保护后端内存 / 磁盘，也避免超长 prompt 挤爆上下文窗口。
_MAX_SKILL_MD = 120_000


def _data_dir() -> Path:
    """返回本机数据根目录：优先环境变量，否则回退到项目下的 .chatvein。"""
    raw = (os.environ.get("CHATVEIN_DATA_DIR") or "").strip()
    if raw:
        return Path(raw).expanduser()
    return Path(__file__).resolve().parents[2] / ".chatvein"


def skills_root() -> Path:
    """返回 / 创建 ``<data_dir>/skills`` 根目录，所有已安装技能都挂在这里。"""
    path = _data_dir() / "skills"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _skill_dir(slug: str) -> Path:
    """把 slug 规范化成该技能的目录路径；slug 非法直接抛 ValueError。"""
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
    """以 SKILL.md 是否存在判定「已安装」；slug 非法视为未安装。"""
    try:
        return _skill_md_path(slug).is_file()
    except ValueError:
        return False


def list_installed() -> list[dict[str, Any]]:
    """扫描 skills 根目录，返回所有已安装技能的展示信息（按名字排序）。

    只把同时具备 SKILL.md 的目录视为有效安装；meta.json 缺失 / 损坏时
    退化为使用目录名，避免历史脏数据把整个列表打崩。
    """
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
    """读取 SKILL.md 正文；文件不存在 / 读失败 / 全空白一律返回 None。"""
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
    """把 SkillHub 详情落到本机；需要 ``skill_md`` 正文。

    流程：slug 校验 → SKILL.md 正文校验（非空、大小上限）→ 创建目录 →
    写入 SKILL.md → 写入 meta.json（含安装时间）。整个过程不是原子的，
    但在应用规模下可接受：失败重试只会覆盖同名文件。
    """
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
    """卸载本机技能：整目录 rmtree。目录不存在返回 False 而非报错。"""
    import shutil

    try:
        target = _skill_dir(slug)
    except ValueError as exc:
        raise ValueError(str(exc)) from exc
    if not target.exists():
        return False
    shutil.rmtree(target)
    return True


def _read_meta(slug: str) -> dict[str, Any]:
    """读取技能 meta.json；缺失 / 损坏一律返回空字典（名字退化为 slug）。"""
    meta_file = _meta_path(slug)
    if not meta_file.is_file():
        return {}
    try:
        loaded = json.loads(meta_file.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, UnicodeError):
        return {}
    return loaded if isinstance(loaded, dict) else {}


def load_skill_blocks(slugs: list[str] | None) -> list[dict[str, str]]:
    """按 slug 读取已安装技能正文，供 Agent system 全文注入（兼容保留）。

    去重规则：按传入顺序去重，未安装的 slug 静默跳过（避免单个缺失让
    整条链中断）；正文超上限按 ``_MAX_SKILL_MD`` 截断，保证 prompt 安全。
    """
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
        meta = _read_meta(slug)
        out.append(
            {
                "slug": slug,
                "name": str(meta.get("name") or slug),
                "body": body[:_MAX_SKILL_MD],
            }
        )
    return out


def _extract_description(body: str) -> str:
    """从 SKILL.md 头部提取一句话简介（meta.description 缺失时兜底）。

    跳过 YAML frontmatter 与标题行，取第一个非空正文段落，截断到 160 字。
    """
    text = body.lstrip()
    if text.startswith("---"):
        parts = text.split("---", 2)
        if len(parts) >= 3:
            text = parts[2]
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("#") or not line:
            continue
        cleaned = line.lstrip("-* \t").strip()
        if cleaned:
            return cleaned[:160]
    return ""


def load_skill_catalog(slugs: list[str] | None) -> list[dict[str, str]]:
    """按 slug 生成技能目录（slug / name / description 一行简介）。

    仅收录已安装技能；未安装 / 重复 slug 静默跳过。description 优先取
    meta.json，缺失时从 SKILL.md 头部提取，保证目录对模型可读。
    """
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for raw in slugs or []:
        slug = str(raw).strip()
        if not slug or slug in seen:
            continue
        seen.add(slug)
        body = read_skill_md(slug)
        if body is None:
            continue
        meta = _read_meta(slug)
        description = str(meta.get("description") or "").strip()
        if not description:
            description = _extract_description(body)
        out.append(
            {
                "slug": slug,
                "name": str(meta.get("name") or slug),
                "description": description,
            }
        )
    return out


def format_skill_catalog_for_prompt(catalog: list[dict[str, str]]) -> str:
    """把技能目录拼成一段 Markdown 提示：只列 name + description + slug。

    明确引导模型在真正需要时调用 ``load_skill(slug)`` 工具加载全文，
    避免长 SKILL.md 一次性占用上下文。
    """
    if not catalog:
        return ""
    lines = [
        "【已启用技能目录 — 仅当任务确实需要下列技能时，"
        "调用 load_skill(slug) 工具加载其完整说明，再按说明执行】"
    ]
    for item in catalog:
        slug = str(item.get("slug") or "")
        name = str(item.get("name") or slug)
        line = f"- {name} (`{slug}`)"
        description = str(item.get("description") or "").strip()
        if description:
            line += f": {description}"
        lines.append(line)
    return "\n".join(lines)


def format_skills_for_prompt(blocks: list[dict[str, str]]) -> str:
    """把技能块拼成一段可以直接粘进 system prompt 的 Markdown 片段。"""
    if not blocks:
        return ""
    parts = ["【已启用技能 — 按下列说明协助用户，真正执行仍用已提供的工具】"]
    for block in blocks:
        parts.append(f"### {block['name']} (`{block['slug']}`)\n{block['body']}")
    return "\n\n".join(parts)
