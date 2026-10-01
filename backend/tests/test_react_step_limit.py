"""图步上限：公式要够跑满语义上限；真撞上时要能拿已有结果收束。"""

from __future__ import annotations

import pytest

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langchain_core.tools import tool

from agents.graphs.common import (
    StepLimitReached,
    build_react_graph,
    invoke_react,
    react_recursion_limit,
    step_limit_reply,
)


class AlwaysCallsTool(BaseChatModel):
    """每次都发一次工具调用的假模型（参数递增，绕开同参去重）。"""

    calls: int = 0

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):  # noqa: ANN001
        self.calls += 1
        return ChatResult(
            generations=[
                ChatGeneration(
                    message=AIMessage(
                        content="",
                        tool_calls=[
                            {"name": "noop", "args": {"i": self.calls}, "id": f"c{self.calls}"}
                        ],
                    )
                )
            ]
        )

    def bind_tools(self, tools, **kwargs):  # noqa: ANN001
        return self

    @property
    def _llm_type(self) -> str:
        return "fake"


@tool
def noop(i: int) -> str:
    """no-op tool."""
    return f"done{i}"


def _graph(model: BaseChatModel):
    return build_react_graph(
        model,
        [noop],
        system_prompt="",
        name="probe",
        max_model_calls=12,
        max_tool_calls=10,
        max_web_search=3,
    )


def test_limit_is_enough_for_the_full_model_call_budget() -> None:
    """步数上限是本轮真正的天花板：不能在第 4 轮就把本轮切掉。"""
    model = AlwaysCallsTool()
    out = invoke_react(
        _graph(model),
        {"messages": [HumanMessage(content="go")]},
        recursion_limit=react_recursion_limit(12),
    )
    # 12 次模型调用全部跑完（由 ModelCallLimitMiddleware 收束），没有中途触顶
    assert model.calls == 12
    assert out.get("messages")


def test_step_limit_surfaces_partial_results() -> None:
    """步数不够时不能再抛框架内部措辞，要带上已收集到的结果。"""
    model = AlwaysCallsTool()
    with pytest.raises(StepLimitReached) as raised:
        invoke_react(
            _graph(model),
            {"messages": [HumanMessage(content="go")]},
            recursion_limit=24,  # 只够约 3 轮
        )
    partial = raised.value.partial
    done = [m for m in partial.get("messages") or [] if isinstance(m, ToolMessage)]
    assert done, "撞步数前跑过的工具结果要带出来"
    reply = step_limit_reply(partial)
    assert "步骤上限" in reply
    assert "done" in reply  # 工具结果在里面


def test_step_limit_reply_falls_back_when_nothing_collected() -> None:
    assert "步骤上限" in step_limit_reply({})
    assert "fallback" in step_limit_reply({}, "fallback")
