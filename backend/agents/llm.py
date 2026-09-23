"""Chat 模型工厂：按角色绑定的模型 ID 构造 langchain 客户端。

不再有「主模型 / 默认模型」的概念；调用方必须显式传入 role（含 ``model_id``）。
角色未绑定模型时返回 None，由上层决定是否降级或提示用户。

仅两种线路协议：
- ``openai``（默认）：出站剥掉 ``reasoning`` / ``reasoning_content``（多数网关只允许回传 content）；
  不发送 DeepSeek 专用 ``thinking`` 字段。
- ``deepseek``：须回传 ``reasoning_content``，关思考用 ``thinking.type=disabled``。

新模型只要走 OpenAI 兼容协议，加配置即可，无需再改代码。
"""

from __future__ import annotations

from typing import Any, Literal

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, SystemMessage
from langchain_deepseek import ChatDeepSeek
from langchain_openai import ChatOpenAI
from pydantic import SecretStr

from models.service import ModelsService  # pyright: ignore[reportImplicitRelativeImport]

from trace import active_callbacks  # pyright: ignore[reportMissingImports]

WireProfile = Literal["openai", "deepseek"]


class ChatOpenAICompat(ChatOpenAI):
    """通用 OpenAI 兼容客户端。

    多轮工具调用时去掉 assistant 上的思考字段，避免各家网关「禁止回传 reasoning」卡死。
    （DeepSeek 相反，走 ``ChatDeepSeekReact``。）
    """

    def _get_request_payload(
        self,
        input_: Any,
        *,
        stop: list[str] | None = None,
        **kwargs: Any,
    ) -> dict:
        payload = super()._get_request_payload(input_, stop=stop, **kwargs)
        for row in payload.get("messages") or []:
            if not isinstance(row, dict) or row.get("role") != "assistant":
                continue
            row.pop("reasoning", None)
            row.pop("reasoning_content", None)
        return payload


class ChatDeepSeekReact(ChatDeepSeek):
    """DeepSeek 线路：多轮把 ``reasoning_content`` 写回 assistant 消息。"""

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
                row["reasoning_content"] = ""
        return payload


def resolve_wire_profile(cfg: Any) -> WireProfile:
    """推断线路协议。默认 openai；仅 DeepSeek 官方线路切到 deepseek。"""
    blob = (
        f"{getattr(cfg, 'provider', '')} "
        f"{getattr(cfg, 'model_id', '')} "
        f"{getattr(cfg, 'base_url', '') or ''}"
    ).lower()
    if "deepseek" in blob:
        return "deepseek"
    return "openai"


def get_chat_model(
    *,
    role: dict[str, Any] | None = None,
    temperature: float | None = None,
    streaming: bool | None = None,
    thinking: bool | None = None,
    timeout: float | None = None,
) -> BaseChatModel | None:
    """按 ``role.model_id`` 构造聊天模型；无 role 或未绑模型时返回 None。

    不再回退到「主/默认模型」——未绑定模型由上层判定（通常提示用户先配置模型）。
    """
    if not role or not role.get("model_id"):
        return None
    try:
        svc = ModelsService()
        cfg = svc.get_entity(role["model_id"])
    except Exception:  # noqa: BLE001
        return None
    if cfg is None or not cfg.enabled or not (cfg.api_key or "").strip():
        return None

    gen_temperature = cfg.temperature
    max_tokens = cfg.max_tokens
    presence = cfg.presence_penalty
    frequency = cfg.frequency_penalty
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

    profile = resolve_wire_profile(cfg)
    if thinking is False and profile == "deepseek":
        kwargs["extra_body"] = {"thinking": {"type": "disabled"}}
    if timeout is not None:
        kwargs["timeout"] = timeout
    callbacks = active_callbacks()
    if callbacks:
        kwargs["callbacks"] = callbacks

    if profile == "deepseek":
        return ChatDeepSeekReact(**kwargs)
    return ChatOpenAICompat(**kwargs)


def invoke_structured(model: BaseChatModel, schema: type, messages: list[Any]) -> Any:
    """按结构化结果调用模型。"""
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
        "message queue",
    )
    return any(marker in text for marker in markers)
