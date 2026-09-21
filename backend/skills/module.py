"""模块组装。"""

from fastapi import APIRouter

from .controller import skills_controller

skills_router = APIRouter(prefix="/api/skills", tags=["skills"])
skills_router.include_router(skills_controller)
