"""chats 业务逻辑：群组成员管理 + 团队模式装配。

团队装配（主 agent 花名册注入 + delegate_to_agent 挂载标记 + 团队上下文）
是「群组 / 团队」领域的核心职责，统一收口在 ChatsService，main.py 只做调用。
"""

from __future__ import annotations

from typing import Any

from .repository import ChatGroupsRepository


class ChatsService:
    """群组 / 团队领域服务（与 conversations 解耦）。"""

    def __init__(self, repository: ChatGroupsRepository | None = None) -> None:
        self._repo = repository or ChatGroupsRepository()

    def get_group_members(self, conversation_id: str) -> list[str]:
        """读取会话群组成员（角色 id 列表）；会话未注册返回空列表。"""
        return self._repo.get_members(conversation_id)

    def register_group_members(self, conversation_id: str, members: list[str] | None) -> list[str]:
        """补注册群组成员：与现有成员合并去重后持久化，返回最新列表。"""
        return self._repo.merge_members(conversation_id, members)

    def assemble_team(
        self,
        role_runtime: dict[str, Any] | None,
        group_members: list[str] | None,
        *,
        workspace_dir: str,
    ) -> dict[str, Any] | None:
        """团队模式装配：主 agent 花名册注入 + delegate_to_agent 挂载标记。

        ``group_members`` 非空时视为团队模式：把成员（名字 + 描述 + role id）注入
        主 agent 的 role prompt（告知可派发对象），并打 ``_team_mode`` 标记——
        medium / hard 的 react 节点据此挂上 ``delegate_to_agent`` 工具。同时把团队
        上下文（workspace_dir + roster）写入 ContextVar，delegate 工具从中读取：
        成员用自己绑定的模型 / 工具 / 按 actor_id 隔离的短期记忆独立完成子任务。

        返回装配后的 ``role_runtime``；未开启团队模式时原样返回。
        """
        from roles.service import RolesService  # pyright: ignore[reportImplicitRelativeImport]

        team_roster: dict[str, dict[str, str]] = {}
        if group_members:
            roles_svc = RolesService()
            for raw_id in group_members:
                rid = str(raw_id).strip()
                if not rid or rid == (role_runtime or {}).get("id"):
                    continue
                runtime = roles_svc.get_runtime(rid)
                if runtime:
                    team_roster[rid] = {
                        "name": str(runtime.get("name") or rid),
                        "description": str(runtime.get("description") or ""),
                    }
        if not team_roster:
            return role_runtime

        roster_lines = "\n".join(
            f"- {m['name']}（id: {rid}）：{m['description'] or '（无描述）'}"
            for rid, m in team_roster.items()
        )
        team_block = (
            "\n\n# 团队成员（花名册）\n"
            "以下成员可以协作。任务适合分工时，用 delegate_to_agent 工具把子任务"
            "派发给合适的成员，并把结果汇总进最终回复；成员会用自己的模型、工具和"
            "独立记忆完成。任务量小、不需要分工时，直接自己完成即可，不必派发。\n"
            f"{roster_lines}"
        )
        base_role = role_runtime or {}
        assembled = {
            **base_role,
            "prompt": f"{(base_role.get('prompt') or '').strip()}\n{team_block}".strip(),
            "_team_mode": True,
            "_roster": team_roster,
        }

        from agents.delegation import set_team_context  # pyright: ignore[reportImplicitRelativeImport]

        set_team_context({"workspace_dir": workspace_dir, "roster": team_roster})
        return assembled


__all__ = ["ChatsService"]
