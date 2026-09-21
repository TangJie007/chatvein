"""聊天未指定角色时，落到内置主对话角色。"""

from roles.entity import CreateRoleDto
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
