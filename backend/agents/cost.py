"""单轮 token 预算与金额估算（batch4 · 4.7）。

为什么熔断看 token 而不是金额：单价是用户自己填的，各家还随时改；拿金额做阈值会让
同一轮对话的行为随「填价」漂移。金额只做展示估算，判据只看 token。

预算按「一轮」计（含并行成员派发出去的调用）：``begin_turn`` 存进 ContextVar，
``note_usage`` 在每个 LLM 回调里累加，ReAct 循环用它决定要不要提前收尾。

账本只记 token：金额由 ``trace/recording.py`` 按 role 单价另算，这里不再抄一份
单价（否则同一个数有两处口径，删掉的是「从没被传过」的那一份）。

开关：``CHATVEIN_TURN_TOKEN_BUDGET``，0 表示不限（默认）。``simple`` 路径是一次
调用、没有后续循环可挡，超预算只在 trace 里看得出，不会追加收尾提示。
"""

from __future__ import annotations

from contextvars import ContextVar, Token
from dataclasses import dataclass
from typing import Any, Final

from agents import config  # pyright: ignore[reportImplicitRelativeImport]

#: 预算触发时注入给模型的话。给的是**下一步**（收尾），不是「你超预算了」这种废话。
CURTAIL_MESSAGE: Final = (
    "本轮 token 预算已用完。不要再调用工具，直接基于已经拿到的信息给出结论；"
    "信息不足就说明缺什么、下一步建议怎么做。"
)

#: 单价单位：每百万 token（和厂商账单一致，避免出现 0.0000123 这种数）。
_PER_MILLION: Final = 1_000_000.0


@dataclass(slots=True)
class TurnBudget:
    """一轮的用量账本。``token_limit <= 0`` 表示不限（只统计）。"""

    token_limit: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    llm_calls: int = 0
    #: 预算触发过没有：只提醒模型一次，避免每轮都塞同一条话。
    curtailed: bool = False

    @property
    def total_tokens(self) -> int:
        return self.input_tokens + self.output_tokens

    @property
    def exceeded(self) -> bool:
        return self.token_limit > 0 and self.total_tokens >= self.token_limit

    def add(self, usage: dict[str, Any] | None) -> None:
        """累加一次调用的用量。usage 形状见 ``trace/recording.py::_usage_dict``。"""
        if not isinstance(usage, dict):
            return
        self.input_tokens += _int(usage.get("input_tokens"))
        self.output_tokens += _int(usage.get("output_tokens"))
        self.llm_calls += 1

    def as_dict(self) -> dict[str, Any]:
        return {
            "token_limit": self.token_limit,
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "total_tokens": self.total_tokens,
            "llm_calls": self.llm_calls,
            "curtailed": self.curtailed,
        }


def _int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def estimate_amount(
    input_tokens: int,
    output_tokens: int,
    price_input: float | None,
    price_output: float | None,
) -> float | None:
    """按「每百万 token」单价估算金额；两项都没填返回 ``None``（不假装知道价钱）。

    结果保留 6 位小数：几分钱量级的差值也要能看见。
    """
    if price_input is None and price_output is None:
        return None
    amount = (
        _int(input_tokens) * float(price_input or 0.0)
        + _int(output_tokens) * float(price_output or 0.0)
    ) / _PER_MILLION
    return round(amount, 6)


def currency() -> str:
    """金额单位，纯展示。默认 ``CNY``（用户多在国内充值），可用环境变量换。"""
    return config.text("CHATVEIN_PRICE_CURRENCY", "CNY")


_current: ContextVar[TurnBudget | None] = ContextVar("chatvein_turn_budget", default=None)


def validate() -> None:
    """启动自检：数字型开关写错要在这里报错。

    否则 ``begin_turn`` 在每一轮里抛 ``ValueError`` → 对外只剩「内部错误」，
    用户永远猜不到是自己把 ``CHATVEIN_TURN_TOKEN_BUDGET`` 写成了 ``5k``。
    """
    config.number("CHATVEIN_TURN_TOKEN_BUDGET", 0, minimum=0)


def begin_turn() -> Token[TurnBudget | None]:
    """开一轮账本。返回的 token 必须交给 ``end_turn``，否则同线程后续轮会串账。

    预算值每轮现读：改环境变量后无需重启进程（评测 / 测试也方便）。
    """
    budget = TurnBudget(
        token_limit=config.number("CHATVEIN_TURN_TOKEN_BUDGET", 0, minimum=0)
    )
    return _current.set(budget)


def end_turn(token: Token[TurnBudget | None]) -> None:
    _current.reset(token)


def current_turn() -> TurnBudget | None:
    """当前账本；不在轮次里（离线调用 / 评测 judge）返回 ``None``。"""
    return _current.get()


def note_usage(usage: dict[str, Any] | None) -> None:
    """LLM 回调里调一次。没有进行中的轮次时什么都不做。"""
    budget = _current.get()
    if budget is not None:
        budget.add(usage)


def over_budget() -> bool:
    budget = _current.get()
    return budget is not None and budget.exceeded


def mark_curtailed() -> bool:
    """标记「已提醒过收尾」。返回 ``True`` 表示本次是第一次（需要注入提示）。

    收尾只做一次：模型被预算掐断后每次模型调用都塞一条 HumanMessage，会把它逼成
    「不断道歉但不出结论」。
    """
    budget = _current.get()
    # 没过预算也调用是调用方的 bug：收尾提示不能因为「传错」而白白注入一次。
    if budget is None or budget.curtailed or not budget.exceeded:
        return False
    budget.curtailed = True
    return True
