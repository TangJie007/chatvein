"""权限配置的请求体（校验在 ``mcps/permissions.py`` 里做，这里只做形状约束）。"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class PermissionsPayload(BaseModel):
    """``PUT /api/permissions`` 的请求体；``rules`` 原样交给 permissions 校验。

    不在这里展开规则字段的原因：规则 DSL 的唯一事实来源是
    ``mcps/permissions.py::PermissionRule``，两处定义必然漂移。
    """

    model_config = ConfigDict(extra="forbid")

    mode: str = "normal"
    rules: list[dict[str, Any]] = Field(default_factory=list)
    quota: dict[str, Any] = Field(default_factory=dict)
