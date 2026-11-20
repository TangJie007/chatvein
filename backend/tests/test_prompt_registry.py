"""提示词注册表（batch4 · 4.4）。"""

from __future__ import annotations

from pathlib import Path

import pytest

from agents import prompt_registry as reg


@pytest.fixture
def _fresh_cache():
    """``_string_constants`` 有 lru_cache：改 ``_ROOT`` 的用例要把缓存清干净。"""
    reg._string_constants.cache_clear()
    yield
    reg._string_constants.cache_clear()


def test_registry_self_check_passes() -> None:
    """本仓库自身必须自洽：`--dry-run` 拿它当门禁，这里先炸出来更好查。"""
    assert reg.verify() == []


def test_versions_stable_and_short() -> None:
    versions = reg.prompt_versions()
    assert reg.prompt_versions() == versions  # 同进程内可重复（AST 读的是同一份源码）
    assert len(versions) == len(reg.PROMPTS)
    for name, version in versions.items():
        assert len(version) == 8 and set(version) <= set("0123456789abcdef"), name


def test_different_prompts_have_different_versions() -> None:
    versions = reg.prompt_versions()
    # framework 与 agent.medium 多了一段分档文案，版本不能相同
    assert len(set(versions.values())) > 1


def test_report_lists_sources() -> None:
    payload = reg.report()
    assert payload["schema_version"] == reg.PROMPT_SCHEMA_VERSION
    prompts = payload["prompts"]
    assert set(prompts) == {spec.id for spec in reg.PROMPTS}
    for entry in prompts.values():
        assert entry["version"]
        assert all("::" in source for source in entry["sources"])


def test_verify_catches_missing_symbol(monkeypatch: pytest.MonkeyPatch) -> None:
    """改了常量名却忘了改注册表 → ``--dry-run`` 必须失败（返回码 2）。"""
    bogus = reg.PromptSpec("agent.broken", (("agents/graphs/prompts.py", "_NO_SUCH"),))
    monkeypatch.setattr(reg, "PROMPTS", reg.PROMPTS + (bogus,))
    problems = reg.verify()
    assert any("agent.broken" in item and "_NO_SUCH" in item for item in problems)


def test_verify_catches_duplicate_id(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(reg, "PROMPTS", reg.PROMPTS + (reg.PROMPTS[0],))
    assert any("重复" in item for item in reg.verify())


def test_version_follows_source_text(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, _fresh_cache: object
) -> None:
    """改一个字版本就变——这是「同样输入答得不一样」的第一道排除项。"""

    def prompts_dir(root: Path, identity: str) -> Path:
        folder = root / "agents" / "graphs"
        folder.mkdir(parents=True)
        (folder / "prompts.py").write_text(
            f'_IDENTITY = {identity!r}\n_WORKSPACE = "同一个工作区"\n',
            encoding="utf-8",
        )
        return root

    spec = reg.PromptSpec("agent.medium", reg._in_prompts("_IDENTITY", "_WORKSPACE"))

    monkeypatch.setattr(reg, "_ROOT", prompts_dir(tmp_path / "a", "第一版"))
    reg._string_constants.cache_clear()
    v1 = reg._version(spec)

    monkeypatch.setattr(reg, "_ROOT", prompts_dir(tmp_path / "b", "第二版"))
    reg._string_constants.cache_clear()
    v2 = reg._version(spec)

    assert v1 != v2
    # 同一份原文（只换目录）版本不变：版本只跟内容走
    reg._string_constants.cache_clear()
    monkeypatch.setattr(reg, "_ROOT", prompts_dir(tmp_path / "c", "第二版"))
    assert reg._version(spec) == v2
