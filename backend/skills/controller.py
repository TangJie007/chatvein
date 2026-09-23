"""HTTP 路由：Skill 市场浏览与本机安装。

路由一览（前缀 ``/api/skills``，由 ``main.py`` 挂载）：
    GET    /categories          分类字典（前端筛选下拉）
    GET    /installed           本机已安装技能列表（聊天附件选择器用）
    GET    /                    代理 SkillHub 公开列表 / 搜索
    GET    /{slug}              代理 SkillHub 技能详情（含 SKILL.md）
    POST   /{slug}/install      下载 SKILL.md 到 ``<data>/skills/<slug>/``
    DELETE /{slug}              卸载本机技能

错误约定：
    - ValueError → 400（slug 格式错等客户端问题）
    - RuntimeError → 502（SkillHub 代理失败）；若报错包含"未找到"则用 404。

注入说明：聊天时的技能注入不经过本文件，入口是 main.py 技能接线段
→ service.skill_prompt_blocks()（见 skills/service.py / docs/skills.md）。
"""

from fastapi import APIRouter, HTTPException, Query

from .service import (
    category_catalog,
    get_skill,
    install_from_hub,
    list_local_skills,
    list_skills,
    uninstall_local,
)

skills_controller = APIRouter()


@skills_controller.get("/categories")
def get_categories():
    """SkillHub 一级分类（本地映射，供前端筛选下拉）。"""
    return {"categories": category_catalog()}


@skills_controller.get("/installed")
def get_installed():
    """本机已安装技能列表：聊天输入框附件菜单直接读这里。"""
    return list_local_skills()


@skills_controller.get("/")
def get_skills(
    page: int = Query(default=1, ge=1, le=500),
    page_size: int = Query(default=24, ge=1, le=50, alias="pageSize"),
    keyword: str | None = Query(default=None, max_length=120),
    category: str | None = Query(default=None, max_length=64),
    sort_by: str = Query(default="score", alias="sortBy", max_length=32),
):
    """代理 SkillHub 公开列表 / 搜索，透传分页与筛选参数。"""
    try:
        return list_skills(
            page=page,
            page_size=page_size,
            keyword=keyword,
            category=category,
            sort_by=sort_by,
        )
    except RuntimeError as exc:
        # 上游异常统一翻译成 502，detail 直接给前端弹 toast
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@skills_controller.get("/{slug}")
def get_skill_detail(slug: str):
    """代理 SkillHub 技能详情（含可选 SKILL.md），供详情抽屉打开时调用。"""
    try:
        return get_skill(slug)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        detail = str(exc)
        status = 404 if "未找到" in detail else 502
        raise HTTPException(status_code=status, detail=detail) from exc


@skills_controller.post("/{slug}/install")
def post_install(slug: str):
    """安装入口：拉详情 → 校验 SKILL.md frontmatter → 落盘。

    成功后返回对象带 ``local`` 字段（path / files / skill_md_chars / installed_at），
    前端据此提示安装位置；同 slug + 同 version 会直接复用现有目录（幂等）。
    """
    try:
        return install_from_hub(slug)
    except ValueError as exc:
        # 上游返回的详情不满足安装条件（slug 非法 / 没有 SKILL.md / frontmatter 缺失）
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        detail = str(exc)
        status = 404 if "未找到" in detail else 502
        raise HTTPException(status_code=status, detail=detail) from exc


@skills_controller.delete("/{slug}")
def delete_skill(slug: str):
    """卸载本机技能：直接删除 <data>/skills/<slug>/ 目录。"""
    try:
        return uninstall_local(slug)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
