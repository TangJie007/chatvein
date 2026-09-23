"""模块组装：把 controller 挂成 ``/api/skills`` 前缀路由，供 main.py include。

    skills_router = APIRouter(prefix="/api/skills", tags=["skills"])
    skills_router.include_router(skills_controller)
"""

from fastapi import APIRouter

from .controller import skills_controller

skills_router = APIRouter(prefix="/api/skills", tags=["skills"])
skills_router.include_router(skills_controller)
