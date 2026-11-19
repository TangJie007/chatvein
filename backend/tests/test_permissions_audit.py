"""批次 3 §3.2：声明式权限规则 + 工具调用审计。"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from langchain_core.messages import ToolMessage

from agents.graphs.common import permission_gate_middleware
from conversations.entity import CreateConversationDto
from conversations.service import ConversationsService
from main import app
from mcps import permissions
from mcps.approval_policy import permission_approval
from mcps.audit import list_events, record_event
from mcps.permissions import (
    check,
    config_view,
    consume_quota,
    permissions_path,
    static_deny,
)
from mcps.registry import resolve_tools
from mcps.sandbox import current_sandbox, use_conversation_sandbox


@pytest.fixture(autouse=True)
def _fresh(monkeypatch: pytest.MonkeyPatch) -> None:
    for key in (
        "CHATVEIN_PERMISSION_MODE",
        "CHATVEIN_PERMISSIONS_PATH",
        "CHATVEIN_AUDIT",
        "CHATVEIN_AUDIT_DB_PATH",
    ):
        monkeypatch.delenv(key, raising=False)
    permissions.reset()
    yield
    permissions.reset()


def _write(payload: dict[str, Any]) -> Path:
    path = permissions_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    permissions.reset()
    return path


@pytest.fixture
def sandbox() -> Any:
    service = ConversationsService()
    created = service.create_conversation(CreateConversationDto())
    with use_conversation_sandbox(created["workspace_dir"]):
        yield current_sandbox()


# --------------------------------------------------------------------------- #
# 规则判定
# --------------------------------------------------------------------------- #


def test_no_config_allows_everything() -> None:
    assert not permissions_path().exists()
    decision = check("web_fetch", {"url": "https://example.com"})
    assert decision.effect == "allow"
    assert decision.by == "mode:normal"
    assert config_view()["exists"] is False


def test_strict_mode_asks_for_unknown_tool(monkeypatch: pytest.MonkeyPatch) -> None:
    _write({"mode": "strict", "rules": []})
    decision = check("web_fetch", {"url": "https://example.com"})
    assert decision.effect == "ask"
    assert decision.by == "mode:strict"

    # 环境变量优先：运维临时放松不用改文件
    monkeypatch.setenv("CHATVEIN_PERMISSION_MODE", "normal")
    assert check("web_fetch", {}).effect == "allow"


def test_tool_glob_and_first_match_wins() -> None:
    _write(
        {
            "rules": [
                {"id": "a", "effect": "allow", "tool": "web_*"},
                {"id": "b", "effect": "deny", "tool": "web_fetch"},
            ]
        }
    )
    decision = check("web_fetch", {})
    assert decision.effect == "allow"
    assert decision.by == "rule:a"


def test_deny_by_tool_name() -> None:
    _write({"rules": [{"id": "no-bash", "effect": "deny", "tool": "bash_run", "note": "禁跑命令"}]})
    decision = check("bash_run", {"command": "rm -rf /"})
    assert decision.effect == "deny"
    assert "禁跑命令" in decision.reason
    assert check("web_fetch", {}).effect == "allow"


def test_path_rule_matches_session_relative(sandbox: Path) -> None:
    _write(
        {
            "rules": [
                {
                    "id": "only-output",
                    "effect": "deny",
                    "tool": "write_file",
                    "path_not_prefix": "session:output/**",
                    "note": "只能写 output",
                }
            ]
        }
    )
    assert check("write_file", {"path": "output/a.txt"}).effect == "allow"
    outside = check("write_file", {"path": "runs/a.py"})
    assert outside.effect == "deny"
    assert "只能写 output" in outside.reason
    # 绝对路径跳出会话也算越界
    assert check("write_file", {"path": str(sandbox.parent / "x.py")}).effect == "deny"


def test_path_prefix_rule_absolute(sandbox: Path) -> None:
    target = (sandbox / "output").as_posix()
    _write(
        {
            "rules": [
                {"effect": "deny", "tool": "*", "path_prefix": target + "/**"},
            ]
        }
    )
    assert check("write_file", {"path": "output/x.txt"}).effect == "deny"
    assert check("write_file", {"path": "runs/x.py"}).effect == "allow"


def test_url_host_rule() -> None:
    _write({"rules": [{"effect": "deny", "tool": "web_fetch", "url_host_in": ["example.com"]}]})
    assert check("web_fetch", {"url": "https://example.com/a"}).effect == "deny"
    assert check("web_fetch", {"url": "https://api.example.com/a"}).effect == "deny"
    assert check("web_fetch", {"url": "https://evil.com/a"}).effect == "allow"


def test_read_only_sql_rule() -> None:
    _write({"rules": [{"effect": "deny", "tool": "sqlite_query", "read_only": False}]})
    assert check("sqlite_query", {"sql": "DELETE FROM t"}).effect == "deny"
    assert check("sqlite_query", {"sql": " SELECT * FROM t"}).effect == "allow"


def test_conditions_are_anded() -> None:
    _write(
        {
            "rules": [
                {
                    "effect": "deny",
                    "tool": "write_file",
                    "path_prefix": "session:*.txt",
                    "url_host_in": ["example.com"],
                }
            ]
        }
    )
    # 路径命中但没有 url 参数 → 不命中（条件需全部满足）
    assert check("write_file", {"path": "a.txt"}).effect == "allow"


def test_static_deny_only_for_unconditional_rules() -> None:
    _write({"rules": [{"effect": "deny", "tool": "sandbox_run_python"}]})
    denied = static_deny("sandbox_run_python")
    assert denied is not None and denied.effect == "deny"
    assert static_deny("write_file") is None

    _write({"rules": [{"effect": "deny", "tool": "write_file", "path_prefix": "session:.env/**"}]})
    assert static_deny("write_file") is None


def test_resolve_tools_drops_statically_denied() -> None:
    _write({"rules": [{"effect": "deny", "tool": "calculator"}]})
    names = [t.name for t in resolve_tools(["calculator", "get_current_time"])]
    assert "calculator" not in names
    assert "get_current_time" in names


# --------------------------------------------------------------------------- #
# 配额
# --------------------------------------------------------------------------- #


def test_quota_per_tool_per_conversation() -> None:
    _write({"rules": [], "quota": {"max_per_tool_per_conversation": 2}})
    assert consume_quota("web_fetch") is None
    assert consume_quota("web_fetch") is None
    over = consume_quota("web_fetch")
    assert over is not None and over.effect == "deny"
    assert over.by == "quota:tool"
    # 计数按工具分开
    assert consume_quota("calculator") is None


def test_quota_per_turn(monkeypatch: pytest.MonkeyPatch) -> None:
    _write({"rules": [], "quota": {"max_per_turn_tool_calls": 2}})
    monkeypatch.setattr(permissions.QuotaGuard, "_turn", lambda self: "turn-x")
    monkeypatch.setattr(permissions.QuotaGuard, "_scope", lambda self: "conv")
    permissions.reset()
    assert consume_quota("web_fetch") is None
    assert consume_quota("calculator") is None
    over = consume_quota("web_fetch")
    assert over is not None and over.by == "quota:turn"


# --------------------------------------------------------------------------- #
# 配置读写 / 错误可见
# --------------------------------------------------------------------------- #


def test_save_config_validates_and_writes() -> None:
    view = permissions.save_config(
        {"mode": "strict", "rules": [{"id": "x", "effect": "deny", "tool": "bash_run"}], "quota": {}}
    )
    assert view["mode"] == "strict"
    assert view["rules"][0]["id"] == "x"
    assert json.loads(permissions_path().read_text(encoding="utf-8"))["mode"] == "strict"


def test_save_config_rejects_unknown_field() -> None:
    with pytest.raises(ValueError) as exc:
        permissions.save_config({"rules": [{"effect": "deny", "tool": "x", "path_pfx": "oops"}]})
    assert "path_pfx" in str(exc.value)


def test_invalid_file_falls_back_but_is_loud() -> None:
    path = permissions_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("{not json", encoding="utf-8")
    permissions.reset()

    view = config_view()
    assert view["error"]
    assert "JSON" in view["error"]
    # 坏配置不生效：退回 normal，而不是半解析后乱拦
    assert check("web_fetch", {}).effect == "allow"
    events = list_events(action="permission.config")
    assert events and events[0]["result_code"] == "INVALID"


def test_rule_id_synthesized_when_missing() -> None:
    _write({"rules": [{"effect": "deny", "tool": "bash_run"}]})
    assert config_view()["rules"][0]["id"] == "rule_1"


# --------------------------------------------------------------------------- #
# 网关中间件
# --------------------------------------------------------------------------- #


class _Req:
    def __init__(self, name: str, args: dict[str, Any], call_id: str = "call_1") -> None:
        self.tool_call = {"name": name, "args": args, "id": call_id}


def test_gate_denies_without_calling_tool() -> None:
    _write({"rules": [{"id": "no-bash", "effect": "deny", "tool": "bash_run", "note": "禁跑命令"}]})
    gate = permission_gate_middleware()[0]
    called: list[int] = []

    def handler(request: Any) -> ToolMessage:
        called.append(1)
        return ToolMessage(content="ok", tool_call_id=request.tool_call["id"])

    out = gate.wrap_tool_call(_Req("bash_run", {"command": "ls"}), handler)
    assert not called
    assert isinstance(out, ToolMessage)
    assert out.status == "error"
    assert "禁跑命令" in str(out.content)
    payload = out.additional_kwargs["tool_result"]
    assert payload["code"] == "TOOL_DENIED"
    events = list_events(action="tool.deny")
    assert events and events[0]["decision"] == "deny"
    assert events[0]["decision_by"] == "rule:no-bash"


def test_gate_allows_and_audits() -> None:
    _write({"rules": [{"effect": "allow", "tool": "bash_run"}]})
    gate = permission_gate_middleware()[0]
    called: list[int] = []

    def handler(request: Any) -> ToolMessage:
        called.append(1)
        return ToolMessage(
            content="ok",
            tool_call_id=request.tool_call["id"],
            additional_kwargs={"tool_result": {"ok": True, "code": "TOOL_OK"}},
        )

    out = gate.wrap_tool_call(_Req("bash_run", {"command": "echo hi"}), handler)
    assert called == [1]
    assert isinstance(out, ToolMessage) and out.status != "error"
    events = list_events(action="tool.call")
    assert events and events[0]["decision"] == "allow"
    assert events[0]["result_code"] == "TOOL_OK"


def test_permission_approval_shape() -> None:
    need = permission_approval("web_fetch", {"url": "https://example.com"}, "需要确认")
    assert need.kind == "permission"
    assert "web_fetch" in need.title
    assert "需要确认" in need.detail


# --------------------------------------------------------------------------- #
# REST
# --------------------------------------------------------------------------- #


def test_rest_permissions_roundtrip() -> None:
    client = TestClient(app)
    view = client.get("/api/permissions").json()
    assert view["mode"] == "normal"
    assert view["path"].endswith("permissions.json")

    bad = client.put(
        "/api/permissions",
        json={"mode": "strict", "rules": [{"effect": "maybe", "tool": "x"}], "quota": {}},
    )
    assert bad.status_code == 400
    assert "effect" in bad.json()["detail"]
    assert not permissions_path().exists()

    ok = client.put(
        "/api/permissions",
        json={
            "mode": "normal",
            "rules": [{"id": "a", "effect": "deny", "tool": "bash_run"}],
            "quota": {"max_per_turn_tool_calls": 0},
        },
    )
    assert ok.status_code == 200
    assert ok.json()["rules"][0]["id"] == "a"


def test_rest_audit_events_redacted_and_filtered() -> None:
    client = TestClient(app)
    assert client.get("/api/audit/status").json()["enabled"] is True

    record_event(
        "tool.call",
        tool="bash_run",
        args={
            "command": "curl -H 'Authorization: Bearer abcdef123456' https://x",
            "api_key": "sk-abcdef123456",
        },
        result_code="TOOL_DENIED",
        decision="deny",
        decision_by="rule:r1",
    )
    record_event("tool.call", tool="web_fetch", args={"url": "https://example.com"})

    denied = client.get("/api/audit/events", params={"decision": "deny"}).json()
    assert denied["count"] == 1
    item = denied["events"][0]
    assert item["tool"] == "bash_run"
    dumped = json.dumps(item["args"], ensure_ascii=False)
    assert "abcdef123456" not in dumped
    assert item["args"]["api_key"] == "***"

    everything = client.get("/api/audit/events", params={"tool": "web_fetch"}).json()
    assert everything["count"] == 1


def test_rest_audit_disabled(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("CHATVEIN_AUDIT", "0")
    monkeypatch.setenv("CHATVEIN_AUDIT_DB_PATH", str(tmp_path / "audit.sqlite"))
    client = TestClient(app)
    assert client.get("/api/audit/status").json()["enabled"] is False
    body = client.get("/api/audit/events").json()
    assert body["events"] == []
    assert not (tmp_path / "audit.sqlite").exists()
