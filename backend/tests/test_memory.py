"""长期记忆（批次 1 §1.4）：写入门槛、作用域召回、注入副本、抽取与巩固、trace 节点。"""

from __future__ import annotations

from pathlib import Path

import pytest

import agents.llm as llm_mod
from memory import store
from memory.entity.dto import CreateMemoryDto, ExtractResult, ExtractedItem, UpdateMemoryDto
from memory.service import MemoryService
from trace.recording import note, tracing


@pytest.fixture(autouse=True)
def memory_db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """每个用例独立 memory.sqlite；默认环境（开启记忆、不自动确认、每轮抽取）。"""
    monkeypatch.setenv("CHATVEIN_MEMORY_DB_PATH", str(tmp_path / "memory.sqlite"))
    for key in (
        "CHATVEIN_MEMORY",
        "CHATVEIN_MEMORY_AUTO_ACCEPT",
        "CHATVEIN_MEMORY_EXTRACT_TURN_INTERVAL",
    ):
        monkeypatch.delenv(key, raising=False)
    store._initialized.clear()
    yield tmp_path / "memory.sqlite"
    store._initialized.clear()


@pytest.fixture()
def service() -> MemoryService:
    return MemoryService()


def test_create_dedupes_normalized_content(service: MemoryService) -> None:
    first = service.create(CreateMemoryDto(content="用户偏好简洁回答。"))
    again = service.create(CreateMemoryDto(content="用户偏好简洁回答"))
    rows = service.list()
    assert len(rows) == 1
    assert rows[0]["id"] == first["id"] == again["id"]
    assert rows[0]["status"] == "active"


def test_sensitive_content_is_rejected(service: MemoryService) -> None:
    with pytest.raises(ValueError):
        service.create(CreateMemoryDto(content="用户的 key 是 sk-abcdefghijklmnop123456"))
    with pytest.raises(ValueError):
        service.create(CreateMemoryDto(content="用户手机号 13800138000"))


def test_scope_visibility(service: MemoryService) -> None:
    service.create(CreateMemoryDto(content="用户是后端工程师", kind="identity"))
    service.create(
        CreateMemoryDto(
            content="这个角色只讲 Python", scope="role", scope_id="role-a", kind="preference"
        )
    )

    rows = service.recall("帮我写个接口", role_id="role-a")
    assert {row["content"] for row in rows} == {"用户是后端工程师", "这个角色只讲 Python"}

    other = service.recall("帮我写个接口", role_id="role-b")
    assert {row["content"] for row in other} == {"用户是后端工程师"}


def test_recall_drops_irrelevant_facts(service: MemoryService) -> None:
    service.create(CreateMemoryDto(content="用户养了一只叫团子的猫", kind="fact"))
    service.create(CreateMemoryDto(content="用户在杭州工作", kind="fact"))
    rows = service.recall("团子最近挑食怎么办")
    assert [row["content"] for row in rows] == ["用户养了一只叫团子的猫"]


def test_recall_into_role_keeps_prompt_copy(service: MemoryService) -> None:
    service.create(CreateMemoryDto(content="用户喜欢表格化输出", kind="preference"))
    role = {"id": "role-a", "prompt": "# Role\n你是严谨的助手", "model_id": "m1"}
    with tracing("测试召回"):
        merged = service.recall_into_role("结果怎么展示比较好", role, conversation_id="c1")
    assert merged is not None
    assert merged["prompt"].startswith("# Role")
    assert "# 长期记忆" in merged["prompt"]
    assert "用户喜欢表格化输出" in merged["prompt"]
    # 原 role 不被污染（role_runtime 可能被缓存复用）
    assert role["prompt"] == "# Role\n你是严谨的助手"
    assert merged["model_id"] == "m1"


def test_disabled_memory_does_not_recall_or_extract(
    service: MemoryService, monkeypatch: pytest.MonkeyPatch
) -> None:
    service.create(CreateMemoryDto(content="用户喜欢表格化输出", kind="preference"))
    monkeypatch.setenv("CHATVEIN_MEMORY", "0")
    assert service.recall("怎么展示") == []
    assert service.extract(user_text="我喜欢表格", reply="好的") == 0


def _fake_extract(monkeypatch: pytest.MonkeyPatch, items: list[ExtractedItem]) -> None:
    monkeypatch.setattr(llm_mod, "get_chat_model", lambda **_: object())
    monkeypatch.setattr(
        llm_mod, "invoke_structured", lambda model, schema, messages: ExtractResult(items=items)
    )


def test_extract_goes_pending_by_default(
    service: MemoryService, monkeypatch: pytest.MonkeyPatch
) -> None:
    _fake_extract(
        monkeypatch,
        [
            ExtractedItem(kind="preference", content="用户要求回答先给结论再展开", confidence=0.8),
            ExtractedItem(kind="fact", content="用户的密钥是 sk-real-secret-abcdefgh", confidence=0.9),
        ],
    )
    assert service.extract(user_text="以后先给结论", reply="明白", turn_id="t1") == 1
    rows = service.list()
    assert len(rows) == 1
    assert rows[0]["status"] == "pending"
    assert rows[0]["source_turn_id"] == "t1"


def test_extract_auto_accept_makes_it_active(
    service: MemoryService, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("CHATVEIN_MEMORY_AUTO_ACCEPT", "1")
    _fake_extract(
        monkeypatch, [ExtractedItem(kind="identity", content="用户是运维工程师", confidence=0.9)]
    )
    assert service.extract(user_text="我是做运维的", reply="好的") == 1
    rows = service.list()
    assert rows[0]["status"] == "active"
    assert service.recall("运维相关的问题")[0]["content"] == "用户是运维工程师"


def test_confirm_then_recall(service: MemoryService) -> None:
    created = service.create(
        CreateMemoryDto(content="用户要求中文回答", kind="preference", status="pending")
    )
    assert service.recall("帮我看看这段日志") == []
    service.update(created["id"], UpdateMemoryDto(status="active"))
    assert service.recall("帮我看看这段日志")


def test_consolidate_merges_duplicates_and_purges_expired(
    service: MemoryService, memory_db: Path
) -> None:
    service.create(CreateMemoryDto(content="用户偏好 Markdown 表格", kind="preference"))
    # 直接插一条同义（不同 scope 前缀的哈希）模拟历史重复
    store.upsert(
        memory_db,
        memory_id="dup-1",
        scope="role",
        scope_id="role-a",
        kind="preference",
        content="用户偏好 markdown 表格。",
        confidence=0.7,
        status="active",
    )
    store.upsert(
        memory_db,
        memory_id="old-1",
        scope="global",
        scope_id="",
        kind="fact",
        content="用户临时项目代号蓝鲸",
        confidence=0.6,
        status="active",
        expires_at="2000-01-01T00:00:00",
    )
    result = service.consolidate()
    assert result["merged"] == 1
    assert result["purged"] == 1
    rows = service.list()
    assert [row["content"] for row in rows] == ["用户偏好 Markdown 表格"]


def test_status_counts(service: MemoryService) -> None:
    service.create(CreateMemoryDto(content="用户喜欢深色主题", kind="preference"))
    service.create(CreateMemoryDto(content="用户这周在做迁移", kind="project", status="pending"))
    status = service.status()
    assert status["total"] == 2
    assert status["active"] == 1
    assert status["pending"] == 1
    assert status["enabled"] is True
    assert status["auto_accept"] is False


def test_rest_round_trip(service: MemoryService) -> None:
    from fastapi.testclient import TestClient

    import main as main_module

    client = TestClient(main_module.app)
    assert client.get("/api/memories/status").json()["total"] == 0

    created = client.post(
        "/api/memories/", json={"content": "用户偏好中文回答", "kind": "preference"}
    )
    assert created.status_code == 200, created.text
    memory_id = created.json()["id"]

    pending = client.patch(f"/api/memories/{memory_id}", json={"status": "pending"})
    assert pending.status_code == 200
    assert pending.json()["status"] == "pending"

    rejected = client.post("/api/memories/", json={"content": "sk-abcdefghijklmnopqrstuv"})
    assert rejected.status_code == 400

    assert client.delete(f"/api/memories/{memory_id}").json()["ok"] is True
    assert client.delete(f"/api/memories/{memory_id}").status_code == 404


def test_trace_path_marks_memory_when_injected() -> None:
    with tracing("问偏好") as recorder:
        note("memory", name="memory", detail={"injected": True, "count": 2})
        snap = recorder.snapshot()
    node = next(item for item in snap["path"] if item["id"] == "memory")
    assert node["taken"] is True


def test_trace_path_memory_off_without_injection() -> None:
    with tracing("普通提问") as recorder:
        note("memory", name="memory", status="skip", detail={"injected": False, "count": 0})
        snap = recorder.snapshot()
    node = next(item for item in snap["path"] if item["id"] == "memory")
    assert node["taken"] is False
