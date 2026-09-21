"""HTTP 路由：Skill 市场浏览。"""

from fastapi import APIRouter, HTTPException, Query

from .service import category_catalog, get_skill, list_skills

skills_controller = APIRouter()


@skills_controller.get("/categories")
def get_categories():
    """SkillHub 一级分类（本地映射，供筛选用）。"""
    return {"categories": category_catalog()}


@skills_controller.get("/")
def get_skills(
    page: int = Query(default=1, ge=1, le=500),
    page_size: int = Query(default=24, ge=1, le=50, alias="pageSize"),
    keyword: str | None = Query(default=None, max_length=120),
    category: str | None = Query(default=None, max_length=64),
    sort_by: str = Query(default="score", alias="sortBy", max_length=32),
):
    """代理 SkillHub 公开列表 / 搜索。安装能力后续再接。"""
    try:
        return list_skills(
            page=page,
            page_size=page_size,
            keyword=keyword,
            category=category,
            sort_by=sort_by,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@skills_controller.get("/{slug}")
def get_skill_detail(slug: str):
    """代理 SkillHub 技能详情（含可选 SKILL.md）。"""
    try:
        return get_skill(slug)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        detail = str(exc)
        status = 404 if "未找到" in detail else 502
        raise HTTPException(status_code=status, detail=detail) from exc
