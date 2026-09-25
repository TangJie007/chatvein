"""线路协议：默认 OpenAI 兼容；仅 DeepSeek 走特例。"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from agents import llm as llm_mod
from agents.llm import ChatDeepSeekReact, ChatOpenAICompat, resolve_wire_profile


def test_wire_profile_defaults_openai_for_sensenova() -> None:
    cfg = SimpleNamespace(
        provider="sensenova",
        model_id="sensenova-6.8-flash-lite",
        base_url="https://token.sensenova.cn/v1",
    )
    assert resolve_wire_profile(cfg) == "openai"


def test_wire_profile_deepseek_only_when_named() -> None:
    cfg = SimpleNamespace(
        provider="deepseek",
        model_id="deepseek-v4-flash",
        base_url="https://api.deepseek.com",
    )
    assert resolve_wire_profile(cfg) == "deepseek"


def test_chat_model_default_timeout_applied() -> None:
    cfg = SimpleNamespace(
        model_id="sensenova-6.8-flash-lite",
        api_key="sk-test",
        base_url="https://token.sensenova.cn/v1",
        enabled=True,
        temperature=0.7,
        max_tokens=4096,
        presence_penalty=0.0,
        frequency_penalty=0.0,
        provider="sensenova",
    )
    fake = MagicMock()
    role = {"model_id": "m-1", "temperature": 0.0}
    with (
        patch.object(llm_mod, "ModelsService", return_value=fake),
        patch.object(llm_mod, "ChatOpenAICompat") as chat_cls,
        patch.object(llm_mod, "active_callbacks", return_value=[]),
    ):
        fake.get_entity.return_value = cfg
        llm_mod.get_chat_model(role=role, temperature=0.0)

    assert chat_cls.call_args.kwargs["timeout"] == llm_mod._DEFAULT_TIMEOUT


def test_chat_model_explicit_timeout_overrides_default() -> None:
    cfg = SimpleNamespace(
        model_id="sensenova-6.8-flash-lite",
        api_key="sk-test",
        base_url="https://token.sensenova.cn/v1",
        enabled=True,
        temperature=0.7,
        max_tokens=4096,
        presence_penalty=0.0,
        frequency_penalty=0.0,
        provider="sensenova",
    )
    fake = MagicMock()
    role = {"model_id": "m-1", "temperature": 0.0}
    with (
        patch.object(llm_mod, "ModelsService", return_value=fake),
        patch.object(llm_mod, "ChatOpenAICompat") as chat_cls,
        patch.object(llm_mod, "active_callbacks", return_value=[]),
    ):
        fake.get_entity.return_value = cfg
        llm_mod.get_chat_model(role=role, temperature=0.0, timeout=60.0)

    assert chat_cls.call_args.kwargs["timeout"] == 60.0


def test_chat_openai_compat_no_thinking_extra_body() -> None:
    cfg = SimpleNamespace(
        model_id="sensenova-6.8-flash-lite",
        api_key="sk-test",
        base_url="https://token.sensenova.cn/v1",
        enabled=True,
        temperature=0.7,
        max_tokens=4096,
        presence_penalty=0.0,
        frequency_penalty=0.0,
        provider="sensenova",
    )
    fake = MagicMock()
    role = {"model_id": "m-1", "temperature": 0.0}
    with (
        patch.object(llm_mod, "ModelsService", return_value=fake),
        patch.object(llm_mod, "ChatOpenAICompat") as chat_cls,
        patch.object(llm_mod, "active_callbacks", return_value=[]),
    ):
        fake.get_entity.return_value = cfg
        llm_mod.get_chat_model(role=role, temperature=0.0, thinking=False)

    kwargs = chat_cls.call_args.kwargs
    assert kwargs["temperature"] == 0
    assert "extra_body" not in kwargs


def test_chat_deepseek_disables_thinking() -> None:
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
    role = {"model_id": "m-1"}
    with (
        patch.object(llm_mod, "ModelsService", return_value=fake),
        patch.object(llm_mod, "ChatDeepSeekReact") as chat_cls,
        patch.object(llm_mod, "active_callbacks", return_value=[]),
    ):
        fake.get_entity.return_value = cfg
        llm_mod.get_chat_model(role=role, thinking=False)

    assert chat_cls.call_args.kwargs["extra_body"] == {"thinking": {"type": "disabled"}}


def test_openai_compat_strips_reasoning_fields() -> None:
    model = ChatOpenAICompat.model_construct(
        model_name="sensenova-6.8-flash-lite",
        openai_api_base="https://token.sensenova.cn/v1",
    )
    parent_payload = {
        "messages": [
            {"role": "user", "content": "hi"},
            {
                "role": "assistant",
                "content": "ok",
                "reasoning": "不要回传",
                "reasoning_content": "也不要",
            },
        ]
    }

    def fake_super(self, input_, *, stop=None, **kwargs):  # noqa: ANN001
        return dict(parent_payload)

    with patch("agents.llm.ChatOpenAI._get_request_payload", fake_super):
        out = ChatOpenAICompat._get_request_payload(model, [HumanMessage(content="hi")])

    assistant = next(m for m in out["messages"] if m["role"] == "assistant")
    assert "reasoning" not in assistant
    assert "reasoning_content" not in assistant
    assert assistant["content"] == "ok"


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

    with patch("agents.llm.ChatDeepSeek._get_request_payload", fake_super):
        out = ChatDeepSeekReact._get_request_payload(
            model,
            [HumanMessage(content="天气怎么样"), ai, tool],
        )

    assistant = next(m for m in out["messages"] if m["role"] == "assistant")
    assert assistant["reasoning_content"] == "先搜天气"
