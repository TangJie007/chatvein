"""安全运营服务：把权限规则与审计库包成 API 需要的形状。"""

from __future__ import annotations

from typing import Any

from mcps import audit, permissions  # pyright: ignore[reportImplicitRelativeImport]


class SecurityService:
    # ------------------------------------------------------------------ 审计

    def audit_status(self) -> dict[str, Any]:
        return {
            "enabled": audit.audit_enabled(),
            "path": str(audit.audit_db_path()),
        }

    def audit_events(
        self,
        *,
        tool: str | None = None,
        action: str | None = None,
        decision: str | None = None,
        since: str | None = None,
        limit: int = 100,
    ) -> dict[str, Any]:
        events = audit.list_events(
            tool=tool, action=action, decision=decision, since=since, limit=limit
        )
        return {
            **self.audit_status(),
            "events": events,
            # 前端要能区分「没开审计」与「开了但还没有事件」。
            "count": len(events),
        }

    # -------------------------------------------------------------- 权限配置

    def permissions_view(self) -> dict[str, Any]:
        return permissions.config_view()

    def save_permissions(self, payload: dict[str, Any]) -> dict[str, Any]:
        """校验 + 落盘；``ValueError`` 由 controller 翻成 400（给到具体字段）。"""
        return permissions.save_config(payload)


security_service = SecurityService()
