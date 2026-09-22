"""一线生产级 Agent system prompt 组装。"""

from agents.graphs.prompts import (
    HARD_SYSTEM_STATIC,
    MEDIUM_SYSTEM_STATIC,
    build_agent_system,
    environment_section,
)
from mcps.sandbox import create_conversation_dir, current_sandbox, use_conversation_sandbox


def test_build_agent_system_has_sections_and_session_root() -> None:
    name = create_conversation_dir()
    with use_conversation_sandbox(name):
        root = str(current_sandbox().resolve())
        text = build_agent_system(tier="medium")
        for heading in (
            "# Identity",
            "# Environment",
            "# Workspace",
            "# Tooling",
            "# Stopping",
            "# Response",
            "# Tier: medium",
        ):
            assert heading in text
        assert root in text
        assert "output/hello.txt" in text  # 正例仍在宪法里
        # Environment 须出现在 Workspace 之前
        assert text.index("# Environment") < text.index("# Workspace")


def test_hard_tier_and_plan_and_role() -> None:
    text = build_agent_system(
        tier="hard",
        role_prompt="你是严谨的审计员。",
        plan_text="1. 读文件\n2. 汇报",
    )
    assert text.startswith("# Role")
    assert "审计员" in text
    assert "# Tier: hard" in text
    assert "# Plan" in text
    assert "读文件" in text


def test_static_skeletons_omit_environment() -> None:
    assert "# Environment" not in MEDIUM_SYSTEM_STATIC
    assert "# Environment" not in HARD_SYSTEM_STATIC
    assert "# Workspace" in MEDIUM_SYSTEM_STATIC


def test_environment_section_without_sandbox() -> None:
    block = environment_section()
    assert block.startswith("# Environment")
    assert "未绑定" in block
