"""DeepSeek ReAct：回传 reasoning_content；路由仍关 thinking。"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from agents import llm as llm_mod
from agents.llm import ChatDeepSeekReact


def test_get_router_model_uses_primary_connection_and_router_params() -> None:
    cfg = SimpleNamespace(
        model_id="deepseek-v4-flash",
        api_key="sk-test",
        base_url="https://api.deepseek.com",
        enabled=True,
        temperature=0.9,
        max_tokens=8192,
        presence_penalty=0.5,
        frequency_penalty=0.5,
        provider="deepseek",
    )
    fake = MagicMock()
    with (
        patch.object(llm_mod, "ModelsService", return_value=fake),
        patch.object(llm_mod, "ChatDeepSeekReact") as chat_cls,
        patch.object(llm_mod, "active_callbacks", return_value=[]),
    ):
        fake.get_runtime_config.return_value = cfg
        llm_mod.get_router_model()

    kwargs = chat_cls.call_args.kwargs
    assert kwargs["model"] == "deepseek-v4-flash"
    assert kwargs["base_url"] == "https://api.deepseek.com"
    assert kwargs["temperature"] == 0
    assert kwargs["streaming"] is False
    assert kwargs["disable_streaming"] is True
    assert kwargs["extra_body"] == {"thinking": {"type": "disabled"}}


def test_react_model_keeps_thinking_for_deepseek() -> None:
    cfg = SimpleNamespace(
        model_id="deepseek-v4-flash",
        api_key="sk-test",
        base_url="https://api.deepseek.com",
        enabled=True,
        temperature=0.7,
        max_tokens=4096,
        presence_penalty=0.0,
        frequency_penalty=0.0,
        provider="deepseek",
    )
    fake = MagicMock()
    with (
        patch.object(llm_mod, "ModelsService", return_value=fake),
        patch.object(llm_mod, "ChatDeepSeekReact") as chat_cls,
        patch.object(llm_mod, "active_callbacks", return_value=[]),
    ):
        fake.get_runtime_config.return_value = cfg
        llm_mod.get_chat_model(timeout=90.0)

    kwargs = chat_cls.call_args.kwargs
    assert "extra_body" not in kwargs
    assert kwargs["timeout"] == 90.0


def test_non_deepseek_uses_chat_openai() -> None:
    cfg = SimpleNamespace(
        model_id="gpt-4o-mini",
        api_key="sk-test",
        base_url="https://api.openai.com/v1",
        enabled=True,
        temperature=0.7,
        max_tokens=4096,
        presence_penalty=0.0,
        frequency_penalty=0.0,
        provider="openai",
    )
    fake = MagicMock()
    with (
        patch.object(llm_mod, "ModelsService", return_value=fake),
        patch.object(llm_mod, "ChatOpenAI") as chat_cls,
        patch.object(llm_mod, "ChatDeepSeekReact") as deep_cls,
        patch.object(llm_mod, "active_callbacks", return_value=[]),
    ):
        fake.get_runtime_config.return_value = cfg
        llm_mod.get_chat_model()

    chat_cls.assert_called_once()
    deep_cls.assert_not_called()


def test_deepseek_react_echoes_reasoning_content() -> None:
    model = ChatDeepSeekReact.model_construct(
        model_name="deepseek-v4-flash",
        api_base="https://api.deepseek.com",
    )
    ai = AIMessage(
        content="",
        tool_calls=[
            {
                "name": "web_search",
                "args": {"query": "天气"},
                "id": "call_1",
                "type": "tool_call",
            }
        ],
        additional_kwargs={"reasoning_content": "先搜天气"},
    )
    tool = ToolMessage(content="晴 25°C", tool_call_id="call_1")
    with patch.object(
        ChatDeepSeekReact,
        "_get_request_payload",
        ChatDeepSeekReact._get_request_payload,
    ):
        # Call the unbound-style via instance; parent may need openai client —
        # patch super path by stubbing parent to return bare payload.
        parent_payload = {
            "messages": [
                {"role": "user", "content": "天气怎么样"},
                {
                    "role": "assistant",
                    "content": "",
                    "tool_calls": [
                        {
                            "id": "call_1",
                            "type": "function",
                            "function": {
                                "name": "web_search",
                                "arguments": '{"query":"天气"}',
                            },
                        }
                    ],
                },
                {"role": "tool", "tool_call_id": "call_1", "content": "晴 25°C"},
            ]
        }

        def fake_super(self, input_, *, stop=None, **kwargs):  # noqa: ANN001
            return dict(parent_payload)

        with patch(
            "agents.llm.ChatDeepSeek._get_request_payload",
            fake_super,
        ):
            out = ChatDeepSeekReact._get_request_payload(
                model,
                [HumanMessage(content="天气怎么样"), ai, tool],
            )

    assistant = next(m for m in out["messages"] if m["role"] == "assistant")
    assert assistant["reasoning_content"] == "先搜天气"
