"""simple / medium / hard 难度图：路由与离线回落。"""

from __future__ import annotations

from agents.graphs.pipeline import build_pipeline, run_pipeline
from agents.service import run_chat


def test_pipeline_routes_simple(monkeypatch) -> None:
    monkeypatch.setattr(
        "agents.graphs.pipeline.router.understand",
        lambda _msg: {
            "rewritten": "你好",
            "difficulty": "simple",
            "reason": "闲聊",
            "used_llm": True,
        },
    )
    monkeypatch.setattr(
        "agents.graphs.pipeline.simple_mod.run_simple",
        lambda _text, **_kwargs: ("你好呀", True),
    )
    out = run_pipeline("hi")
    assert out["difficulty"] == "simple"
    assert out["route"] == "simple"
    assert out["reply"] == "你好呀"
    assert out["rewritten"] == "你好"
    assert out["selected_tools"] == []
    assert out["used_llm"] is True


def test_pipeline_routes_medium_react(monkeypatch) -> None:
    monkeypatch.setattr(
        "agents.graphs.pipeline.router.understand",
        lambda _msg: {
            "rewritten": "现在几点",
            "difficulty": "medium",
            "reason": "需要时间工具",
            "used_llm": True,
        },
    )

    def fake_medium(rewritten: str, **kwargs):
        assert rewritten == "现在几点"
        assert kwargs.get("name") == "medium_react"
        return {
            "reply": "现在是中午",
            "selected_tools": ["get_current_time"],
            "tool_plan_reason": "时间",
            "used_llm": True,
            "tool_trace": [],
        }

    monkeypatch.setattr("agents.graphs.pipeline.medium_mod.run_medium", fake_medium)
    out = run_pipeline("几点了")
    assert out["difficulty"] == "medium"
    assert out["reply"] == "现在是中午"
    assert out["selected_tools"] == ["get_current_time"]
    assert out["tool_plan_reason"] == "时间"


def test_pipeline_hard_uses_hard_graph(monkeypatch) -> None:
    monkeypatch.setattr(
        "agents.graphs.pipeline.router.understand",
        lambda _msg: {
            "rewritten": "改代码直到跑通",
            "difficulty": "hard",
            "reason": "多步",
            "used_llm": True,
        },
    )
    seen: dict[str, str] = {}

    def fake_hard(rewritten: str, **kwargs):
        seen["name"] = str(kwargs.get("name"))
        assert rewritten == "改代码直到跑通"
        return {
            "reply": "已跑通",
            "selected_tools": ["sandbox_run_python"],
            "tool_plan_reason": "沙箱",
            "used_llm": True,
            "tool_trace": [],
            "plan": {"goal": "改代码直到跑通", "steps": ["写", "跑"], "success_criteria": ["通过"]},
            "verify_reason": "已满足成功标准",
            "verify_passed": True,
        }

    monkeypatch.setattr("agents.graphs.pipeline.hard_mod.run_hard", fake_hard)
    out = run_pipeline("修一下")
    assert out["difficulty"] == "hard"
    assert seen["name"] == "hard_react"
    assert out["reply"] == "已跑通"


def test_run_chat_offline_simple(monkeypatch) -> None:
    monkeypatch.setattr("agents.router.llm_mod.get_chat_model", lambda **_kwargs: None)
    monkeypatch.setattr("agents.graphs.simple.llm_mod.get_chat_model", lambda **_kwargs: None)
    out = run_chat("你好")
    assert out["difficulty"] == "simple"
    assert out["used_llm"] is False
    assert "离线" in out["reply"]


def test_run_chat_offline_medium_runs_tools(monkeypatch) -> None:
    monkeypatch.setattr("agents.router.llm_mod.get_chat_model", lambda **_kwargs: None)
    monkeypatch.setattr("agents.tool_selector.llm_mod.get_chat_model", lambda **_kwargs: None)
    monkeypatch.setattr("agents.graphs.medium.llm_mod.get_chat_model", lambda **_kwargs: None)
    monkeypatch.setattr(
        "agents.graphs.medium.run_tools",
        lambda _text, names: f"TOOL:{','.join(names)}",
    )
    out = run_chat("现在几点")
    assert out["difficulty"] == "medium"
    assert out["used_llm"] is False
    assert "get_current_time" in out["selected_tools"]
    assert out["reply"].startswith("TOOL:")


def test_run_chat_offline_hard_plan_verify(monkeypatch) -> None:
    monkeypatch.setattr("agents.router.llm_mod.get_chat_model", lambda **_kwargs: None)
    monkeypatch.setattr("agents.tool_selector.llm_mod.get_chat_model", lambda **_kwargs: None)
    monkeypatch.setattr("agents.graphs.hard.llm_mod.get_chat_model", lambda **_kwargs: None)
    monkeypatch.setattr(
        "agents.graphs.hard.run_tools",
        lambda _text, names: f"HARD:{','.join(names)}",
    )
    # force hard via understand offline heuristic won't work for greeting;
    # monkeypatch understand through router used by pipeline
    monkeypatch.setattr(
        "agents.graphs.pipeline.router.understand",
        lambda _msg: {
            "rewritten": "用沙箱反复改代码直到通过",
            "difficulty": "hard",
            "reason": "测试",
            "used_llm": False,
        },
    )
    out = run_chat("修到通过")
    assert out["difficulty"] == "hard"
    assert out["used_llm"] is False
    assert out["reply"].startswith("HARD:")


def test_build_pipeline_compiles() -> None:
    g = build_pipeline()
    assert g is not None


def test_expand_allowlist_groups() -> None:
    from agents.tool_selector import expand_allowlist

    names = expand_allowlist(["core", "get_current_time"])
    assert names is not None
    assert "get_current_time" in names
    assert "calculator" in names
