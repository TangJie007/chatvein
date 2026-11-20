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
from contextvars import ContextVar
from typing import Any, Callable, Literal, TypeVar

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, SystemMessage
from langchain_deepseek import ChatDeepSeek
from langchain_openai import ChatOpenAI
from pydantic import PrivateAttr, SecretStr

from errors import (  # pyright: ignore[reportImplicitRelativeImport]
    MODEL_AUTH,
    MODEL_FAILED,
    MODEL_NOT_FOUND,
    MODEL_RATE_LIMIT,
    MODEL_TIMEOUT,
    classify,
)
from models.service import ModelsService  # pyright: ignore[reportImplicitRelativeImport]

from trace.recording import active_callbacks, note_model_fallback

from agents import config as agent_config  # pyright: ignore[reportImplicitRelativeImport]
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

#: 值得在气泡里直说的「模型侧」码；其余错误由调用方组织人话。
_MODEL_HINT_CODES = frozenset(
    {MODEL_RATE_LIMIT, MODEL_AUTH, MODEL_NOT_FOUND, MODEL_TIMEOUT, MODEL_FAILED}
)

#: 值得降级到备用模型的码：限流 / 超时 / 5xx。
#: 鉴权失败不降级——多半是密钥填错，备用模型走同类网关也一样失败，只会掩盖真因。
_FALLBACK_CODES = frozenset({MODEL_RATE_LIMIT, MODEL_TIMEOUT, MODEL_FAILED})

#: 一轮是否已经降级过。降级只在结构化调用里做，且整轮最多一次，
#: 否则主备会随着两边抖动来回切换，一轮发出好几份结论。
_fallback_used: ContextVar[bool] = ContextVar("chatvein_fallback_used", default=False)


def reset_fallback_used() -> None:
    """每轮开始清一次（``graphs/pipeline.py`` 调）。"""
    _fallback_used.set(False)


def is_rate_limit_error(exc: BaseException) -> bool:
    """是不是供应商限流（429 / TPM·RPM 超限）。

    判定规则只有一处：``errors.classify``（状态码与报文特征都判，命中即算）。
    """
    return classify(exc, stage="llm").code == MODEL_RATE_LIMIT


def model_error_hint(exc: BaseException) -> str | None:
    """模型侧原因（限流 / 鉴权 / 404 / 5xx）的可读提示；认不出来返回 ``None``。

    只有拿到供应商状态码、或报文明确是限流时才认领：裸 ``TimeoutError`` 可能
    是图跑满 300s，硬说成「模型超时」会让用户查错方向。
    """
    err = classify(exc, stage="llm")
    if err.code not in _MODEL_HINT_CODES:
        return None
    if err.code != MODEL_RATE_LIMIT and not err.detail.get("status"):
        return None
    return err.message


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

    #: 这条实例来自哪条 ``llm_models`` 配置；结构化调用失败时据此找回备用模型。
    _chatvein_config_id: str | None = PrivateAttr(default=None)

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

    #: 同 ``ChatOpenAICompat``：标记配置来源，供备用模型查找。
    _chatvein_config_id: str | None = PrivateAttr(default=None)

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

    chat: BaseChatModel
    if profile == "deepseek":
        chat = ChatDeepSeekReact(**kwargs)
    else:
        chat = ChatOpenAICompat(**kwargs)
    # 单测会用 SimpleNamespace 顶替配置实体（没有 id）——那时就是「不可降级」
    chat._chatvein_config_id = str(getattr(cfg, "id", "") or "") or None
    return chat


def fallback_model(model: BaseChatModel) -> BaseChatModel | None:
    """主模型的备用模型实例；没配 / 已停用 / 本轮已降级过时返回 ``None``。

    开关 ``CHATVEIN_MODEL_FALLBACK``（默认开）。
    """
    if _fallback_used.get() or not agent_config.flag("CHATVEIN_MODEL_FALLBACK", True):
        return None
    primary_id = getattr(model, "_chatvein_config_id", None)
    if not primary_id:
        return None
    try:
        svc = ModelsService()
        primary = svc.get_entity(str(primary_id))
        fallback_id = getattr(primary, "fallback_config_id", None) if primary else None
        if not fallback_id or fallback_id == primary_id:
            return None
        cfg = svc.get_entity(str(fallback_id))
    except Exception:  # noqa: BLE001 — 查配置失败不该影响本轮主调用
        return None
    if cfg is None or not cfg.enabled or not (cfg.api_key or "").strip():
        return None
    # 备用模型自己的温度 / 上限才合理；结构化调用总是非流式、关思考。
    # 传得很保守：`get_chat_model` 里 thinking=False 只对 deepseek 线路生效。
    return get_chat_model(role={"model_id": cfg.id}, streaming=False, thinking=False)


def invoke_structured(model: BaseChatModel, schema: type, messages: list[Any]) -> Any:
    """按结构化结果调用模型；主模型命中限流 / 超时 / 5xx 时整轮降级一次。"""
    try:
        return _structured_call(model, schema, messages)
    except Exception as exc:  # noqa: BLE001
        if classify(exc, stage="llm").code not in _FALLBACK_CODES:
            raise
        backup = fallback_model(model)
        if backup is None:
            raise
        _fallback_used.set(True)
        note_model_fallback(
            from_config=str(getattr(model, "_chatvein_config_id", "") or ""),
            to_config=str(getattr(backup, "_chatvein_config_id", "") or ""),
            code=classify(exc, stage="llm").code,
        )
        return _structured_call(backup, schema, messages)


def _structured_call(model: BaseChatModel, schema: type, messages: list[Any]) -> Any:
    """结构化调用本身：先 function_calling，被网关拒绝再退回 json_mode。"""
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
