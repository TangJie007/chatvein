"""ChatOpenAI 工厂：读 ModelsService 运行时配置，可被角色覆盖。"""

from __future__ import annotations

from typing import Any

from langchain_openai import ChatOpenAI
from pydantic import SecretStr

from models.service import ModelsService  # pyright: ignore[reportImplicitRelativeImport]


def get_chat_model(
    *,
    temperature: float | None = None,
    role: dict[str, Any] | None = None,
) -> ChatOpenAI | None:
    """返回一个 ChatOpenAI 实例。

    - 角色 ``role`` 提供 ``model_id`` 时，优先用该模型连接；
    - 否则回退到运行时配置（主 → 默认 → 首条启用）。
    生成参数（温度 / Max Tokens / 惩罚项）以角色值为准，角色未给则用模型默认值。
    """
    try:
        svc = ModelsService()
        cfg = None
        if role and role.get("model_id"):
            cfg = svc.get_entity(role["model_id"])
        if cfg is None:
            cfg = svc.get_runtime_config()
    except Exception:  # noqa: BLE001
        return None
    if cfg is None or not cfg.enabled or not (cfg.api_key or "").strip():
        return None

    gen_temperature = cfg.temperature
    max_tokens = cfg.max_tokens
    presence = cfg.presence_penalty
    frequency = cfg.frequency_penalty
    if role:
        if role.get("temperature") is not None:
            gen_temperature = float(role["temperature"])
        if role.get("max_tokens"):
            max_tokens = int(role["max_tokens"])
        if role.get("presence_penalty") is not None:
            presence = float(role["presence_penalty"])
        if role.get("frequency_penalty") is not None:
            frequency = float(role["frequency_penalty"])

    if temperature is not None:
        gen_temperature = temperature

    kwargs: dict = {
        "model": cfg.model_id,
        "api_key": SecretStr(cfg.api_key or ""),
        "temperature": gen_temperature,
        "max_tokens": max_tokens,
        "presence_penalty": presence,
        "frequency_penalty": frequency,
    }
    if cfg.base_url:
        kwargs["base_url"] = cfg.base_url
    return ChatOpenAI(**kwargs)
