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


def test_skill_catalog_uses_meta_description(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("CHATVEIN_DATA_DIR", str(tmp_path))
    local_store.install_skill(
        {
            "slug": "meta-desc",
            "name": "Meta Desc",
            "description": "来自 meta 的简介",
            "version": "1.0.0",
            "homepage": "",
            "skill_md": "# Meta Desc\n\n正文正文。",
        }
    )
    catalog = local_store.load_skill_catalog(["meta-desc", "not-installed"])
    assert len(catalog) == 1
    assert catalog[0]["slug"] == "meta-desc"
    assert catalog[0]["name"] == "Meta Desc"
    assert catalog[0]["description"] == "来自 meta 的简介"


def test_skill_catalog_falls_back_to_md_head(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("CHATVEIN_DATA_DIR", str(tmp_path))
    local_store.install_skill(
        {
            "slug": "no-desc",
            "name": "No Desc",
            "description": "",
            "version": "1.0.0",
            "homepage": "",
            "skill_md": "# No Desc\n\n第一句简介。\n\n更多内容。",
        }
    )
    catalog = local_store.load_skill_catalog(["no-desc"])
    assert catalog[0]["description"] == "第一句简介。"


def test_format_skill_catalog_guides_load_skill(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("CHATVEIN_DATA_DIR", str(tmp_path))
    local_store.install_skill(
        {
            "slug": "guide",
            "name": "Guide",
            "description": "指南简介",
            "version": "1.0.0",
            "homepage": "",
            "skill_md": "# Guide\n\n正文。",
        }
    )
    text = local_store.format_skill_catalog_for_prompt(
        local_store.load_skill_catalog(["guide"])
    )
    assert "Guide" in text and "(`guide`)" in text
    assert "指南简介" in text
    assert "load_skill" in text
