"""聊天未指定角色时，落到内置主对话角色。"""

from roles.entity import CreateRoleDto, UpdateRoleDto
from roles.service import RolesService


def test_resolve_for_chat_defaults_to_primary() -> None:
    svc = RolesService()
    primary = svc.create_role(
        CreateRoleDto(name="主对话角色", prompt="primary-prompt", primary=True)
    )
    other = svc.create_role(CreateRoleDto(name="客服", prompt="other-prompt"))

    fallback = svc.resolve_for_chat(None)
    assert fallback is not None
    assert fallback["id"] == primary.id
    assert fallback["name"] == "主对话角色"
    assert fallback["prompt"] == "primary-prompt"

    missing = svc.resolve_for_chat("does-not-exist")
    assert missing is not None
    assert missing["id"] == primary.id

    explicit = svc.resolve_for_chat(other.id)
    assert explicit is not None
    assert explicit["id"] == other.id
    assert explicit["prompt"] == "other-prompt"


def test_resident_skills_roundtrip_and_runtime() -> None:
    """角色级常驻技能：create / update / get_runtime 全链路透传。"""
    svc = RolesService()
    created = svc.create_role(
        CreateRoleDto(
            name="客服",
            prompt="p",
            resident_skills=["skill-a", "skill-b"],
        )
    )
    # 响应 DTO 应带出列表
    assert created.resident_skills == ["skill-a", "skill-b"]

    # 更新（新增 skill-c 后应保留原有顺序 + 追加）
    updated = svc.update_role(
        created.id,
        UpdateRoleDto(resident_skills=["skill-b", "skill-c"]),
    )
    assert updated is not None
    assert updated.resident_skills == ["skill-b", "skill-c"]

    # 运行时字典（供 chat() 合并技能用）
    runtime = svc.get_runtime(created.id)
    assert runtime is not None
    assert runtime["resident_skills"] == ["skill-b", "skill-c"]


def test_resident_skills_default_empty() -> None:
    """未显式传入时，resident_skills 默认为空列表。"""
    svc = RolesService()
    r = svc.create_role(CreateRoleDto(name="n", prompt="p"))
    assert r.resident_skills == []
    runtime = svc.get_runtime(r.id)
    assert runtime is not None
    assert runtime["resident_skills"] == []
