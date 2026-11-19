"""Token 估算与上下文预算。

只做估算和预算分配，不改写消息；真正的裁剪 / 摘要在 ``context.py``。

优先用 ``tiktoken``（装了就用，没装走字符启发式），因此不新增硬依赖。
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

#: 与 models 实体默认一致（``context_window_k = 128``）。
DEFAULT_CONTEXT_WINDOW = 128_000
#: 模型未配置 ``max_tokens`` 时的输出预留。
DEFAULT_OUTPUT_RESERVE = 4096
#: 协议开销 / 模板 / 估算误差的安全余量。
_BUDGET_MARGIN = 256
#: 历史预算下限：再紧也要给最近两条消息留位置。
_MIN_HISTORY_BUDGET = 512

_encoder: Any = None
_encoder_failed = False


def _env_int(name: str, default: int) -> int:
    try:
        raw = (os.environ.get(name) or "").strip()
        return int(raw) if raw else default
    except ValueError:
        return default


def _is_cjk(ch: str) -> bool:
    code = ord(ch)
    return (
        0x4E00 <= code <= 0x9FFF
        or 0x3400 <= code <= 0x4DBF
        or 0x3000 <= code <= 0x303F
        or 0xFF00 <= code <= 0xFFEF
    )


def _tiktoken_encoder() -> Any:
    global _encoder, _encoder_failed
    if _encoder is not None or _encoder_failed:
        return _encoder
    try:
        import tiktoken  # type: ignore[import-not-found]

        _encoder = tiktoken.get_encoding("cl100k_base")
    except Exception:  # noqa: BLE001 - 未安装/离线编码表缺失都退回启发式
        _encoder_failed = True
        _encoder = None
    return _encoder


def estimate_text_tokens(text: str) -> int:
    """字符启发式估算：CJK 约 1 token / 1.5 字，ASCII 约 1 token / 4 字符。

    取保守上界（宁可多留余量，也不要低估导致超窗）。
    """
    if not text:
        return 0
    cjk = sum(1 for ch in text if _is_cjk(ch))
    other = len(text) - cjk
    return max(1, int(cjk / 1.5 + other / 4.0) + 1)


def count_text_tokens(text: str) -> int:
    """文本 token 数：有 tiktoken 用精确值，否则用启发式。"""
    if not text:
        return 0
    encoder = _tiktoken_encoder()
    if encoder is None:
        return estimate_text_tokens(text)
    try:
        return max(1, len(encoder.encode(text)))
    except Exception:  # noqa: BLE001
        return estimate_text_tokens(text)


def _content_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict) and block.get("type") == "text":
                parts.append(str(block.get("text") or ""))
        return "\n".join(parts)
    return str(content or "")


def count_message_tokens(messages: list[Any]) -> int:
    """LangChain 消息列表的 token 估算（每条 +4 的格式开销）。"""
    total = 0
    for msg in messages:
        total += count_text_tokens(_content_text(getattr(msg, "content", ""))) + 4
    return total


def count_rows_tokens(rows: list[dict[str, Any]]) -> int:
    """会话历史行（``role/content``）的 token 估算。"""
    total = 0
    for row in rows:
        total += count_text_tokens(str(row.get("content") or "")) + 4
    return total


@dataclass(frozen=True)
class ContextBudget:
    """四段预算：system / 历史 / 本轮输入 / 输出预留。"""

    context_window: int
    output_reserve: int
    system_tokens: int
    input_tokens: int

    @property
    def history_budget(self) -> int:
        available = (
            self.context_window
            - self.output_reserve
            - self.system_tokens
            - self.input_tokens
            - _BUDGET_MARGIN
        )
        return max(_MIN_HISTORY_BUDGET, available)

    def report(self) -> dict[str, int]:
        return {
            "context_window": self.context_window,
            "output_reserve": self.output_reserve,
            "system_tokens": self.system_tokens,
            "input_tokens": self.input_tokens,
            "history_budget": self.history_budget,
        }


def resolve_budget(
    *,
    model_id: str | None = None,
    role: dict[str, Any] | None = None,
    system_prompt: str = "",
    input_text: str = "",
) -> ContextBudget:
    """按模型配置推导预算；任一环节读不到就退回默认值。"""
    window = 0
    max_tokens = 0
    if model_id:
        try:
            from models.service import ModelsService  # pyright: ignore[reportImplicitRelativeImport]

            cfg = ModelsService().get_entity(model_id)
            if cfg is not None:
                window = int(getattr(cfg, "context_window_k", 0) or 0) * 1000
                max_tokens = int(getattr(cfg, "max_tokens", 0) or 0)
        except Exception:  # noqa: BLE001 - 无库 / 无配置时走默认
            pass

    if role and role.get("max_tokens"):
        try:
            max_tokens = int(role["max_tokens"])
        except (TypeError, ValueError):
            pass

    env_window = _env_int("CHATVEIN_CTX_WINDOW", 0)
    if env_window > 0:
        window = env_window
    if window <= 0:
        window = DEFAULT_CONTEXT_WINDOW

    reserve = _env_int("CHATVEIN_CTX_OUTPUT_RESERVE", 0)
    if reserve <= 0:
        reserve = max_tokens or DEFAULT_OUTPUT_RESERVE
    reserve = max(512, min(reserve, window // 2))

    return ContextBudget(
        context_window=window,
        output_reserve=reserve,
        system_tokens=count_text_tokens(system_prompt),
        input_tokens=count_text_tokens(input_text),
    )
