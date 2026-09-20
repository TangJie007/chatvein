"""ChatOpenAI 工厂：读 ModelsService 运行时配置。"""

from __future__ import annotations

from langchain_openai import ChatOpenAI
from pydantic import SecretStr

from models.service import ModelsService  # pyright: ignore[reportImplicitRelativeImport]


def get_chat_model(*, temperature: float | None = None) -> ChatOpenAI | None:
    try:
        cfg = ModelsService().get_runtime_config()
    except Exception:  # noqa: BLE001
        return None
    if cfg is None or not cfg.enabled or not (cfg.api_key or "").strip():
        return None

    kwargs: dict = {
        "model": cfg.model_id,
        "api_key": SecretStr(cfg.api_key or ""),
        "temperature": cfg.temperature if temperature is None else temperature,
        "max_tokens": cfg.max_tokens,
    }
    if cfg.base_url:
        kwargs["base_url"] = cfg.base_url
    return ChatOpenAI(**kwargs)
