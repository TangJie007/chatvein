"""单轮 token 预算（batch4 · 4.7）。"""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from langchain_core.messages import ToolMessage

from agents import cost
from agents.graphs.common import budget_middlewares


@pytest.fixture(autouse=True)
def _clean_budget(monkeypatch: pytest.MonkeyPatch):
    """每个用例从「无预算」开始，且跑完把 ContextVar 收回去。"""

    monkeypatch.delenv("CHATVEIN_TURN_TOKEN_BUDGET", raising=False)
    token = cost.begin_turn()
    yield
    cost.end_turn(token)


def test_estimate_amount_per_million() -> None:
    # 输入 1M token @1.0 + 输出 0.5M token @2.0 = 1.0 + 1.0
    assert cost.estimate_amount(1_000_000, 500_000, 1.0, 2.0) == 2.0
    assert cost.estimate_amount(1000, 1000, None, None) is None
    # 只填一边也算：另一边按 0 计，不假装知道
    assert cost.estimate_amount(1_000_000, 0, 3.0, None) == 3.0


def test_budget_counts_usage_and_trips_at_limit() -> None:
    budget = cost.TurnBudget(token_limit=100)
    budget.add({"input_tokens": 60, "output_tokens": 30})
    assert budget.total_tokens == 90
    assert budget.exceeded is False

    budget.add({"input_tokens": 20, "output_tokens": 0})
    assert budget.total_tokens == 110
    assert budget.exceeded is True
    assert budget.as_dict()["total_tokens"] == 110


def test_zero_limit_means_unlimited() -> None:
    """0 = 关闭预算（默认）。不设限时不能因为「用量已超过 0」而立刻收尾。"""
    budget = cost.TurnBudget(token_limit=0)
    budget.add({"input_tokens": 1000, "output_tokens": 1000})
    assert budget.exceeded is False


def test_note_usage_requires_open_turn() -> None:
    assert cost.over_budget() is False
    assert cost.begin_turn is not None  # 接口存在性：调用点依赖这两个函数
    cost.note_usage({"total_tokens": 999})  # 未开轮：静默忽略，不能抛


def test_budget_env_written_wrongly_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    """写错就抛：静默退回「不限」等于预算从来没生效过。"""
    monkeypatch.setenv("CHATVEIN_TURN_TOKEN_BUDGET", "abc")
    with pytest.raises(ValueError):
        cost.begin_turn()


def test_block_tool_when_over_budget() -> None:
    current = cost.current_turn()
    assert current is not None
    current.token_limit = 100
    current.add({"input_tokens": 120})

    block = budget_middlewares()[0].wrap_tool_call
    ran: list[str] = []

    def handler(request):  # noqa: ANN001
        ran.append("run")
        return ToolMessage(content="ok", tool_call_id=request.tool_call["id"])

    request = SimpleNamespace(tool_call={"name": "read_file", "args": {}, "id": "c1"})
    result = block(request, handler)
    assert isinstance(result, ToolMessage)
    assert "预算" in str(result.content)
    assert ran == []


def test_tool_still_runs_within_budget() -> None:
    block = budget_middlewares()[0].wrap_tool_call
    request = SimpleNamespace(tool_call={"name": "read_file", "args": {}, "id": "c1"})
    result = block(request, lambda req: ToolMessage(content="ok", tool_call_id=req.tool_call["id"]))
    assert isinstance(result, ToolMessage)
    assert result.content == "ok"


def test_curtail_injected_only_once() -> None:
    current = cost.current_turn()
    assert current is not None
    current.token_limit = 100
    current.add({"input_tokens": 120})

    before = budget_middlewares()[1].before_model
    first = before({}, None)
    assert isinstance(first, dict) and len(first["messages"]) == 1
    assert cost.CURTAIL_MESSAGE in str(first["messages"][0].content)
    # 第二次模型调用不再重复注入，否则模型会一直道歉不收敛
    assert before({}, None) is None


def test_validate_rejects_bad_budget_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """启动自检：数字写错要在这里报，别拖到每一轮聊天都变成「内部错误」。"""
    monkeypatch.setenv("CHATVEIN_TURN_TOKEN_BUDGET", "5k")
    with pytest.raises(ValueError):
        cost.validate()
