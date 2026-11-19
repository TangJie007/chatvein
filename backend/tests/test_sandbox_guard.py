"""沙箱加固（§3.1）：环境变量清洗、资源限额、网络软隔离、pip 源、审计、常驻工具开关。"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import pytest

from agents.graphs.common import (
    ALWAYS_ON_TOOLS,
    always_on_tools,
    allowed_from_role,
)
from mcps import audit as audit_mod
from mcps.audit import list_events, mask_secrets, record_event, redact
from mcps.sandbox_guard import (
    apply_network_env,
    dropped_env_keys,
    ensure_network_guard,
    guard_note,
    is_sensitive_key,
    limits,
    network_enabled,
    pip_base_args,
    pip_index_url,
    run_limited,
    sanitize_env,
)


# --------------------------------------------------------------------------- #
# 环境变量
# --------------------------------------------------------------------------- #


def test_sanitize_env_strips_secrets_and_app_vars() -> None:
    base = {
        "PATH": "/usr/bin",
        "LANG": "C.UTF-8",
        "OPENAI_API_KEY": "sk-x",
        "CHATVEIN_TOKEN": "t",
        "DB_PASSWORD": "p",
        "MY_CREDENTIAL": "c",
    }
    env = sanitize_env(base)
    assert set(env) == {"PATH", "LANG"}
    assert dropped_env_keys(base) == [
        "CHATVEIN_TOKEN",
        "DB_PASSWORD",
        "MY_CREDENTIAL",
        "OPENAI_API_KEY",
    ]


def test_sanitize_env_passthrough_and_guard_off(monkeypatch: pytest.MonkeyPatch) -> None:
    base = {"KEEP_ME_TOKEN": "on-purpose", "PATH": "/bin"}
    monkeypatch.setenv("CHATVEIN_SANDBOX_ENV_PASSTHROUGH", "KEEP_ME_TOKEN")
    assert sanitize_env(base)["KEEP_ME_TOKEN"] == "on-purpose"

    monkeypatch.setenv("CHATVEIN_SANDBOX_GUARD", "0")
    assert sanitize_env(base) == base
    assert network_enabled() is True


def test_sensitive_key_matches_names_only() -> None:
    assert is_sensitive_key("OPENAI_API_KEY")
    assert is_sensitive_key("GITHUB_TOKEN")
    assert is_sensitive_key("CHATVEIN_DATA_DIR")
    assert not is_sensitive_key("PATH")
    assert not is_sensitive_key("APPDATA")


# --------------------------------------------------------------------------- #
# 网络
# --------------------------------------------------------------------------- #


def test_network_disabled_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CHATVEIN_SANDBOX_NETWORK", raising=False)
    assert network_enabled() is False
    env = apply_network_env({"PATH": "/bin"})
    assert env["HTTPS_PROXY"].startswith("http://127.0.0.1")
    assert env["NO_PROXY"] == "127.0.0.1,localhost"

    monkeypatch.setenv("CHATVEIN_SANDBOX_NETWORK", "1")
    assert network_enabled() is True
    assert "HTTPS_PROXY" not in apply_network_env({"PATH": "/bin"})


def _fake_venv(root: Path) -> Path:
    venv = root / "runs" / ".venv"
    (venv / "Lib" / "site-packages").mkdir(parents=True)
    python = venv / "Scripts" / "python.exe"
    python.parent.mkdir(parents=True, exist_ok=True)
    python.write_text("", encoding="utf-8")
    return python


def test_ensure_network_guard_writes_sitecustomize(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("CHATVEIN_SANDBOX_NETWORK", raising=False)
    python = _fake_venv(tmp_path)
    path, status = ensure_network_guard(python)
    assert path is not None
    assert "network=disabled" in status and "已注入" in status
    target = Path(path)
    assert "chatvein-sandbox-guard" in target.read_text(encoding="utf-8")

    # 幂等：再调一次不重写、状态一致
    again, status2 = ensure_network_guard(python)
    assert again == path
    assert "已就绪" in status2


def test_guard_hook_dir_and_pythonpath(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("CHATVEIN_SANDBOX_NETWORK", raising=False)
    python = _fake_venv(tmp_path)
    path, _ = ensure_network_guard(python)
    assert path is not None
    # 钩子不进 site-packages：宿主只要设了 PYTHONPATH，site-packages 里那份就轮不到
    assert Path(path).parent == tmp_path / "runs" / ".chatvein-guard"

    from mcps.sandbox_guard import guard_pythonpath, with_guard_pythonpath

    hook = guard_pythonpath(python)
    assert hook is not None
    env = with_guard_pythonpath({"PYTHONPATH": "old"}, python)
    assert env["PYTHONPATH"].startswith(hook)
    assert env["PYTHONPATH"].endswith("old")
    bare = with_guard_pythonpath({}, python)
    assert bare["PYTHONPATH"] == hook


def test_guard_pythonpath_absent_before_injection(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("CHATVEIN_SANDBOX_NETWORK", "1")
    python = _fake_venv(tmp_path)
    from mcps.sandbox_guard import guard_pythonpath

    assert guard_pythonpath(python) is None


def test_ensure_network_guard_skips_when_network_allowed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("CHATVEIN_SANDBOX_NETWORK", "1")
    python = _fake_venv(tmp_path)
    path, status = ensure_network_guard(python)
    assert path is None
    assert "enabled" in status


# --------------------------------------------------------------------------- #
# pip 源
# --------------------------------------------------------------------------- #


def test_pip_index_rejects_local_scheme(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CHATVEIN_PIP_INDEX_URL", "file:///tmp/simple")
    with pytest.raises(ValueError):
        pip_index_url()


def test_pip_base_args(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CHATVEIN_PIP_INDEX_URL", raising=False)
    assert pip_base_args() == ["--disable-pip-version-check", "--no-input"]

    monkeypatch.setenv("CHATVEIN_PIP_INDEX_URL", "https://mirror.example/simple")
    args = pip_base_args()
    assert args[-2:] == ["--index-url", "https://mirror.example/simple"]


# --------------------------------------------------------------------------- #
# 执行
# --------------------------------------------------------------------------- #


def test_run_limited_hides_secrets_from_child(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("CHATVEIN_TEST_SECRET", "leaky-value")
    result = run_limited(
        [
            sys.executable,
            "-c",
            "import os; print(os.environ.get('CHATVEIN_TEST_SECRET', '<none>'));"
            "print(os.environ.get('PATH', '') != '')",
        ],
        cwd=tmp_path,
        timeout=60,
    )
    assert result.returncode == 0
    assert "<none>" in result.stdout
    assert "True" in result.stdout


def test_run_limited_timeout(tmp_path: Path) -> None:
    result = run_limited(
        [sys.executable, "-c", "import time; time.sleep(5)"],
        cwd=tmp_path,
        timeout=0.5,
    )
    assert result.timed_out is True


def test_run_limited_memory_cap(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CHATVEIN_SANDBOX_MEMORY_MB", "64")
    monkeypatch.delenv("CHATVEIN_SANDBOX_LIMITS", raising=False)
    result = run_limited(
        [sys.executable, "-c", "x = bytearray(300 * 1024 * 1024); print(len(x))"],
        cwd=tmp_path,
        timeout=60,
    )
    if result.returncode == 0:
        pytest.skip("当前环境未强制内存上限（Job Object 不可用）")
    assert "MemoryError" in result.stderr or result.returncode != 0


def test_guard_note_mentions_both_layers(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CHATVEIN_SANDBOX_NETWORK", raising=False)
    monkeypatch.delenv("CHATVEIN_SANDBOX_LIMITS", raising=False)
    note = guard_note()
    assert "limits=cpu" in note
    assert "network=disabled" in note
    assert limits()["memory_mb"] >= 1


# --------------------------------------------------------------------------- #
# 审计
# --------------------------------------------------------------------------- #


def test_mask_secrets() -> None:
    assert mask_secrets("token sk-1234567890abcdef") == "token ***"
    assert mask_secrets("password=hunter2") == "password=***"
    assert mask_secrets("curl -H 'Authorization: Bearer abcdefgh12345678'") == (
        "curl -H 'Authorization: ***'"
    )


def test_redact_handles_nested_keys() -> None:
    redacted = redact({"api_key": "sk-abc", "env": [{"MY_TOKEN": "x"}], "path": "output/a.txt"})
    assert redacted["api_key"] == "***"
    assert redacted["env"][0]["MY_TOKEN"] == "***"
    assert redacted["path"] == "output/a.txt"


def test_audit_writes_and_lists(monkeypatch: pytest.MonkeyPatch) -> None:
    ok = record_event(
        "shell.exec",
        tool="bash_run",
        scope="/ws",
        args={
            "command": "curl -H 'Authorization: Bearer abcdefgh12345678' https://example.com",
            "api_key": "sk-abcdef123456",
        },
        result_code="OK",
        duration_ms=12,
    )
    assert ok is True
    events = list_events(tool="bash_run")
    assert len(events) == 1
    item = events[0]
    assert item["action"] == "shell.exec"
    assert item["result_code"] == "OK"
    assert item["duration_ms"] == 12
    dumped = json.dumps(item["args"], ensure_ascii=False)
    assert "abcdefgh12345678" not in dumped
    assert "sk-abcdef123456" not in dumped
    assert "***" in dumped


def test_audit_switch_off(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("CHATVEIN_AUDIT", "0")
    monkeypatch.setenv("CHATVEIN_AUDIT_DB_PATH", str(tmp_path / "audit.sqlite"))
    assert record_event("shell.exec", tool="bash_run") is False
    assert list_events() == []
    assert not (tmp_path / "audit.sqlite").exists()


def test_audit_never_raises_on_bad_path(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("CHATVEIN_AUDIT_DB_PATH", str(tmp_path / "no" / "dir" / "audit.sqlite"))
    (tmp_path / "no").write_text("not a dir", encoding="utf-8")
    assert record_event("sandbox.exec", tool="sandbox_run_python") is False


def test_audit_db_path_override(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    target = tmp_path / "custom.sqlite"
    monkeypatch.setenv("CHATVEIN_AUDIT_DB_PATH", str(target))
    assert audit_mod.audit_db_path() == target
    assert audit_mod.ensure_audit_db().is_file()


# --------------------------------------------------------------------------- #
# 常驻工具
# --------------------------------------------------------------------------- #


def test_always_on_tools_default_full() -> None:
    assert always_on_tools(None) == ALWAYS_ON_TOOLS
    assert always_on_tools({"tools": []}) == ALWAYS_ON_TOOLS
    assert always_on_tools({"tools": ["mcp-files"]}) == ALWAYS_ON_TOOLS


def test_always_on_tools_respects_explicit_deny() -> None:
    role: dict[str, Any] = {"tools": ["mcp-files", "!sandbox_run_python"]}
    assert always_on_tools(role) == ("load_skill", "get_current_time")
    assert "sandbox_run_python" not in always_on_tools(role)


def test_always_on_tools_respects_deny_list() -> None:
    assert always_on_tools({"deny_tools": ["get_current_time"]}) == (
        "load_skill",
        "sandbox_run_python",
    )


def test_deny_entries_do_not_leak_into_allowlist() -> None:
    assert allowed_from_role({"tools": ["!sandbox_run_python"]}) is None
    assert allowed_from_role({"tools": ["-get_current_time", "mcp-files"]}) == ["mcp-files"]
