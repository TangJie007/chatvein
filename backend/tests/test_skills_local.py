"""本机技能安装落盘。"""

from __future__ import annotations

from pathlib import Path

from skills import local_store


def test_install_and_load_skill(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("CHATVEIN_DATA_DIR", str(tmp_path))
    installed = local_store.install_skill(
        {
            "slug": "demo-skill",
            "name": "Demo",
            "description": "测试",
            "version": "1.0.0",
            "homepage": "https://example.com",
            "skill_md": "# Demo\n\n做 X。",
        }
    )
    assert installed["slug"] == "demo-skill"
    assert (tmp_path / "skills" / "demo-skill" / "SKILL.md").is_file()
    assert local_store.is_installed("demo-skill")
    rows = local_store.list_installed()
    assert len(rows) == 1
    blocks = local_store.load_skill_blocks(["demo-skill", "missing"])
    assert len(blocks) == 1
    prompt = local_store.format_skills_for_prompt(blocks)
    assert "Demo" in prompt
    assert local_store.uninstall_skill("demo-skill") is True
    assert local_store.is_installed("demo-skill") is False
