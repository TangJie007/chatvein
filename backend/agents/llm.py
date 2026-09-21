"""ChatOpenAI 工厂：读 ModelsService 运行时配置，可被角色覆盖。"""

from __future__ import annotations

from typing import Any

from langchain_core.messages import SystemMessage
from langchain_openai import ChatOpenAI
from pydantic import SecretStr

from models.service import ModelsService  # pyright: ignore[reportImplicitRelativeImport]

from trace import active_callbacks  # pyright: ignore[reportMissingImports]


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
    callbacks = active_callbacks()
    if callbacks:
        kwargs["callbacks"] = callbacks
    return ChatOpenAI(**kwargs)


def invoke_structured(model: ChatOpenAI, schema: type, messages: list[Any]) -> Any:
    """按结构化结果调用模型。

    ``ChatOpenAI.with_structured_output`` 默认 ``method="json_schema"``，会发送
    ``response_format.type=json_schema``。DeepSeek 等兼容接口只接受 ``json_object``
    或工具调用，否则返回 400：``This response_format type is unavailable now``。
    """
    last: BaseException | None = None
    for method in ("function_calling", "json_mode"):
        payload = messages
        if method == "json_mode":
            payload = _with_json_hint(schema, messages)
        try:
            return model.with_structured_output(schema, method=method).invoke(payload)
        except Exception as exc:
            last = exc
            if method == "json_mode" or not _structured_method_rejected(exc):
                raise
    if last is not None:
        raise last
    raise RuntimeError("结构化调用未执行")


def _with_json_hint(schema: type, messages: list[Any]) -> list[Any]:
    from langchain_core.output_parsers import PydanticOutputParser

    hint = SystemMessage(
        content=(
            "请只输出 JSON。\n"
            + PydanticOutputParser(pydantic_object=schema).get_format_instructions()
        )
    )
    return [*messages, hint]


def _structured_method_rejected(exc: BaseException) -> bool:
    text = str(exc).lower()
    markers = (
        "response_format",
        "json_schema",
        "unavailable now",
        "tool_choice",
        "parallel_tool_calls",
        "does not support tools",
        "tools is not supported",
        "function calling is not supported",
        "invalid_request_error",
        "error code: 400",
    )
    return any(marker in text for marker in markers)
