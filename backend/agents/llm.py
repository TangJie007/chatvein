"""Chat 模型工厂：读 ModelsService 运行时配置，可被角色覆盖。

DeepSeek thinking + 工具多轮时，API 要求回传 ``reasoning_content``。
``ChatOpenAI`` / 上游 ``ChatDeepSeek`` 都会在序列化时丢掉该字段，导致 ReAct
第二轮 400 或卡住。本模块对 DeepSeek 使用带回传补丁的子类，让 ReAct 可保留 thinking。
"""

from __future__ import annotations

from typing import Any

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, SystemMessage
from langchain_deepseek import ChatDeepSeek
from langchain_openai import ChatOpenAI
from pydantic import SecretStr

from models.service import ModelsService  # pyright: ignore[reportImplicitRelativeImport]

from trace import active_callbacks  # pyright: ignore[reportMissingImports]


class ChatDeepSeekReact(ChatDeepSeek):
    """DeepSeek：多轮请求时把 ``reasoning_content`` 写回 assistant 消息。

    与官方文档 / langchain#37177 一致：thinking 模式下跟过 tool 之后的请求
    必须带回上一轮的 reasoning，否则 HTTP 400。
    """

    def _get_request_payload(
        self,
        input_: Any,
        *,
        stop: list[str] | None = None,
        **kwargs: Any,
    ) -> dict:
        payload = super()._get_request_payload(input_, stop=stop, **kwargs)
        originals = self._convert_input(input_).to_messages()
        reasoning_queue: list[str | None] = []
        for msg in originals:
            if isinstance(msg, AIMessage):
                extra = msg.additional_kwargs or {}
                if "reasoning_content" in extra:
                    reasoning_queue.append(extra.get("reasoning_content"))
                else:
                    reasoning_queue.append(None)

        idx = 0
        for row in payload.get("messages") or []:
            if not isinstance(row, dict) or row.get("role") != "assistant":
                continue
            if idx >= len(reasoning_queue):
                break
            value = reasoning_queue[idx]
            idx += 1
            if value is not None:
                row["reasoning_content"] = value
            elif row.get("tool_calls"):
                # 有 tool_calls 的 assistant 轮次也要求带上该字段（可为空串）。
                row["reasoning_content"] = ""
        return payload


def _is_deepseek(cfg: Any) -> bool:
    blob = f"{getattr(cfg, 'provider', '')} {getattr(cfg, 'model_id', '')} {getattr(cfg, 'base_url', '') or ''}"
    return "deepseek" in blob.lower()


def get_chat_model(
    *,
    temperature: float | None = None,
    role: dict[str, Any] | None = None,
    streaming: bool | None = None,
    thinking: bool | None = None,
    timeout: float | None = None,
) -> BaseChatModel | None:
    """返回聊天模型实例。

    - 角色 ``role`` 提供 ``model_id`` 时，优先用该模型连接；
    - 否则回退到运行时配置（主 → 默认 → 首条启用）。
    生成参数（温度 / Max Tokens / 惩罚项）以角色值为准，角色未给则用模型默认值。

    DeepSeek（含兼容网关）走 ``ChatDeepSeekReact``，可保留 thinking + 工具多轮；
    其它供应商仍用 ``ChatOpenAI``。

    ``streaming`` / ``thinking``：
    - ``None``：沿用供应商默认；
    - ``False``：显式关闭（路由 / 结构化判定等不需要长思考的路径）。

    ``timeout``：单次 HTTP 请求超时（秒）；``None`` 不覆盖库默认。
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

    kwargs: dict[str, Any] = {
        "model": cfg.model_id,
        "api_key": SecretStr(cfg.api_key or ""),
        "temperature": gen_temperature,
        "max_tokens": max_tokens,
        "presence_penalty": presence,
        "frequency_penalty": frequency,
    }
    if cfg.base_url:
        kwargs["base_url"] = cfg.base_url
    if streaming is False:
        kwargs["streaming"] = False
        kwargs["disable_streaming"] = True
    elif streaming is True:
        kwargs["streaming"] = True
    if thinking is False:
        # 路由 / 结构化：不需要长思考；且 thinking 下强制 tool_choice 会 400。
        kwargs["extra_body"] = {"thinking": {"type": "disabled"}}
    if timeout is not None:
        kwargs["timeout"] = timeout
    callbacks = active_callbacks()
    if callbacks:
        kwargs["callbacks"] = callbacks

    if _is_deepseek(cfg):
        return ChatDeepSeekReact(**kwargs)
    return ChatOpenAI(**kwargs)


def get_router_model() -> BaseChatModel | None:
    """路由 Agent 专用模型。

    只复用主模型（运行时配置）的 ``model_id`` / ``api_key`` / ``base_url``；
    生成参数按路由语义固定：温度 0、关闭 thinking、非流式。
    """
    return get_chat_model(temperature=0, streaming=False, thinking=False)


def invoke_structured(model: BaseChatModel, schema: type, messages: list[Any]) -> Any:
    """按结构化结果调用模型。

    ``with_structured_output`` 默认 ``method="json_schema"``，会发送
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
