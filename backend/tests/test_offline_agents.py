"""无主模型时的路由与工具选择，不访问网络。"""

from agents.router import understand
from agents.tool_selector import select_tools


def test_offline_chat_is_simple(monkeypatch) -> None:
    monkeypatch.setattr("agents.router.llm_mod.get_chat_model", lambda **_kwargs: None)
    decision = understand("你好")
    assert decision["used_llm"] is False
    assert decision["difficulty"] == "simple"
    assert decision["rewritten"] == "你好"


def test_offline_tool_intent_is_medium(monkeypatch) -> None:
    monkeypatch.setattr("agents.router.llm_mod.get_chat_model", lambda **_kwargs: None)
    decision = understand("现在几点")
    assert decision["difficulty"] == "medium"
    assert "get_current_time" in decision["reason"]


def test_offline_tool_selector_uses_heuristics(monkeypatch) -> None:
    monkeypatch.setattr("agents.tool_selector.llm_mod.get_chat_model", lambda **_kwargs: None)
    plan = select_tools("帮我算一下 (1+2)*3")
    assert plan["used_llm"] is False
    assert "calculator" in plan["selected_tools"]
