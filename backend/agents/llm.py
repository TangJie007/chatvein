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

import os
import random
import time
from typing import Any, Callable, Literal, TypeVar

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, SystemMessage
from langchain_deepseek import ChatDeepSeek
from langchain_openai import ChatOpenAI
from pydantic import SecretStr

from models.service import ModelsService  # pyright: ignore[reportImplicitRelativeImport]

from trace.recording import active_callbacks

from agents.cancellation import (  # pyright: ignore[reportImplicitRelativeImport]
    TurnCancelled,
    current_turn_id,
    is_cancelled,
)

WireProfile = Literal["openai", "deepseek"]

#: 单次模型调用的兜底超时（秒）：网关挂起 / 网络黑洞时不能无限占住工作线程。
#: 调用方可显式传 ``timeout`` 覆盖；None 时使用本默认值。
_DEFAULT_TIMEOUT = 300.0

T = TypeVar("T")


def _env_number(name: str, default: float) -> float:
    raw = (os.environ.get(name) or "").strip()
    try:
        return float(raw) if raw else default
    except ValueError:
        return default


#: 供应商限流（429 / TPM·RPM 超限）时的退避重试参数。
#: openai SDK 自带 2 次秒级退避，对「按分钟结算」的配额基本没用，
#: 所以上层再补一层长退避；配额释放通常在几十秒量级。
_RATE_LIMIT_RETRIES = int(_env_number("CHATVEIN_LLM_RATE_LIMIT_RETRIES", 3))
_RATE_LIMIT_INITIAL_DELAY = _env_number("CHATVEIN_LLM_RATE_LIMIT_DELAY", 10.0)
_RATE_LIMIT_MAX_DELAY = _env_number("CHATVEIN_LLM_RATE_LIMIT_MAX_DELAY", 60.0)

#: 判定的报文特征（各网关措辞不一）：必须小写比较。
_RATE_LIMIT_MARKERS = (
    "rate limit",
    "rate_limit",
    "rate-limit",
    "ratelimit",
    "too many requests",
    "quota",
    "tpm",
    "rpm",
    "429",
)


def is_rate_limit_error(exc: BaseException) -> bool:
    """是不是供应商限流（429 / TPM·RPM 超限）。

    只看报文会漏（`status_code` 未必被透传），只看状态码会漏改造过的网关，
    所以两者都判命中即算。
    """
    if _status_code(exc) == 429:
        return True
    text = f"{type(exc).__name__} {exc}".lower()
    return any(marker in text for marker in _RATE_LIMIT_MARKERS)


def _status_code(exc: BaseException) -> int | None:
    status = getattr(exc, "status_code", None)
    response = getattr(exc, "response", None)
    if status is None and response is not None:
        status = getattr(response, "status_code", None)
    try:
        return int(status) if status is not None else None
    except (TypeError, ValueError):
        return None


def _request_id(exc: BaseException) -> str:
    for source in (getattr(exc, "request_id", None), getattr(exc, "body", None)):
        if isinstance(source, str) and source.strip():
            return source.strip()
        if isinstance(source, dict):
            found = source.get("request_id") or source.get("id")
            if found:
                return str(found)
    return ""


def model_error_hint(exc: BaseException) -> str | None:
    """模型侧原因（限流 / 鉴权 / 404 / 5xx）的可读提示；认不出来返回 ``None``。"""
    rid = _request_id(exc)
    suffix = f"（request_id: {rid}）" if rid else ""
    status = _status_code(exc)
    if is_rate_limit_error(exc):
        return (
            "模型供应商限流（HTTP 429）：本轮请求超过该模型的 TPM/RPM 配额，"
            f"已自动退避重试仍未通过。请稍后再试，或在「模型」里换额度更宽的模型。{suffix}"
        )
    if status in (401, 403):
        return f"模型鉴权失败（HTTP {status}）：请检查该模型的 Key 是否有效、是否有此模型权限。{suffix}"
    if status == 404:
        return f"模型不可访问（HTTP 404）：请核对模型 ID 与网关地址。{suffix}"
    if status is not None and status >= 500:
        return f"模型服务端异常（HTTP {status}）：供应商侧暂时不可用，可稍后重试。{suffix}"
    return None


def describe_model_error(exc: BaseException) -> str:
    """``model_error_hint`` 之外回落到通用文案（react 兜底回复用）。"""
    return model_error_hint(exc) or f"工具调用失败({exc})"


def rate_limit_retries() -> int:
    """限流时最多重试几次（不含首次调用）。"""
    return _RATE_LIMIT_RETRIES


def rate_limit_wait(attempt: int) -> None:
    """第 ``attempt`` 次重试前的退避等待（可被用户取消打断）。"""
    delay = min(_RATE_LIMIT_INITIAL_DELAY * (2**attempt), _RATE_LIMIT_MAX_DELAY)
    _wait_interruptible(delay + random.uniform(0.0, delay * 0.25))


def call_with_rate_limit_retry(fn: Callable[[], T]) -> T:
    """调用 LLM，遇到限流就退避重试；其余异常照常抛出。"""
    for attempt in range(_RATE_LIMIT_RETRIES + 1):
        try:
            return fn()
        except Exception as exc:  # noqa: BLE001
            if attempt >= _RATE_LIMIT_RETRIES or not is_rate_limit_error(exc):
                raise
            rate_limit_wait(attempt)
    raise AssertionError("unreachable")  # pragma: no cover


def _wait_interruptible(total: float) -> None:
    """可被取消打断的 sleep：退避期间用户点停止能立刻收尾。"""
    end = time.monotonic() + max(0.0, total)
    while True:
        if is_cancelled():
            raise TurnCancelled(current_turn_id() or "")
        remaining = end - time.monotonic()
        if remaining <= 0:
            return
        time.sleep(min(0.5, remaining))


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

    技能注入：角色的 ``prompt``（含 main.py 拼好的 SKILL.md 技能块）已由调用方
    作为 system prompt 传给 LangGraph 的 ``create_agent``，模型请求在此发出。
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
    # 默认给一个兜底超时：不传 timeout 时按 _DEFAULT_TIMEOUT，避免挂起的
    # 请求无限占住线程（配合 async 路由的 to_thread 卸载一起控制并发占用）。
    kwargs["timeout"] = timeout if timeout is not None else _DEFAULT_TIMEOUT
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
            # 路由 / 选型 / 规划这类结构化调用也要能扛住限流
            return call_with_rate_limit_retry(
                lambda: model.with_structured_output(schema, method=method).invoke(payload)
            )
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
