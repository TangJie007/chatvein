"""路由模型：主模型连接 + 温度 0 / 关 thinking / 非流式。"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from agents import llm as llm_mod


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
    )
    fake = MagicMock()
    with (
        patch.object(llm_mod, "ModelsService", return_value=fake),
        patch.object(llm_mod, "ChatOpenAI") as chat_cls,
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
