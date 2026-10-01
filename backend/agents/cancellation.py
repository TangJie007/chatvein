"""真·取消：按 ``turn_id`` 中断在途的一轮生成。

前端点「停止 / 撤回 / 编辑」时除了 abort HTTP，还会 ``POST /api/chat/cancel``
带上本轮 ``turn_id``。工作线程在**每一次模型调用前 / 工具调用前**检查该集合，
命中就抛 :class:`TurnCancelled`，本轮立刻收尾（追踪写 ``cancelled``），
而不是让后端在用户离开后继续把剩余步骤全部空跑完。

``turn_id`` 用 ContextVar 绑到工作线程：请求入口（``main._run_chat_heavy``）
绑定，结束时解绑并回收条目；因此不同会话 / 不同成员轮次互不干扰。
"""

from __future__ import annotations

import threading
import time
from contextvars import ContextVar
from typing import Callable

#: 取消记录的保留时长：超时自动丢弃，避免集合无限增长。
_TTL_S = 30 * 60
#: 条数上限（兜底）：超出时丢掉最旧的一半。
_MAX_ENTRIES = 256

_lock = threading.Lock()
#: turn_id -> 被取消时的时间戳
_cancelled: dict[str, float] = {}

_current_turn_id: ContextVar[str | None] = ContextVar(
    "chatvein_current_turn_id", default=None
)


class TurnCancelled(RuntimeError):
    """本轮已被用户取消：图内检查点抛出，外层收尾为 ``cancelled``。"""

    def __init__(self, turn_id: str = "") -> None:
        super().__init__("本轮已被用户取消")
        self.turn_id = turn_id


def bind_turn(turn_id: str | None) -> None:
    """把当前工作线程绑定到某一轮，供各检查点查询。"""
    _current_turn_id.set(turn_id or None)


def current_turn_id() -> str | None:
    """当前线程绑定的 turn_id（未绑定返回 ``None``）。"""
    return _current_turn_id.get()


def cancel_turn(turn_id: str) -> bool:
    """标记某一轮为已取消。返回是否受理（空 id 不受理）。"""
    key = (turn_id or "").strip()
    if not key:
        return False
    with _lock:
        _prune_locked()
        _cancelled[key] = time.monotonic()
    return True


def clear_turn(turn_id: str) -> None:
    """轮次结束：回收条目（之后再来 cancel 不会有残留影响）。"""
    key = (turn_id or "").strip()
    if not key:
        return
    with _lock:
        _cancelled.pop(key, None)


def is_cancelled(turn_id: str | None = None) -> bool:
    """``turn_id`` 省略时查当前线程绑定的那一轮。"""
    key = (turn_id if turn_id is not None else _current_turn_id.get()) or ""
    if not key:
        return False
    with _lock:
        return key in _cancelled


def raise_if_cancelled() -> None:
    """检查点：本轮已取消就抛 :class:`TurnCancelled`。

    抛之前先把追踪收尾成 ``cancelled``——这样即使异常被上层宽泛
    ``except Exception`` 吃掉，库里的终态也不会停在 ``running``。
    """
    key = _current_turn_id.get()
    if not key or not is_cancelled(key):
        return
    # 延迟导入：trace 不依赖 agents，避免导入环。
    from trace.recording import cancel_current_turn  # pyright: ignore[reportImplicitRelativeImport]

    cancel_current_turn()
    raise TurnCancelled(key)


def cancel_probe() -> Callable[[], bool]:
    """给阻塞等待用的探针（返回 True 表示本轮已取消）。

    供命令审批等待这类长阻塞使用：未绑定轮次时永远返回 False。
    """
    key = _current_turn_id.get()
    if not key:
        return lambda: False
    return lambda: is_cancelled(key)


def _prune_locked() -> None:
    """调用方需持有 ``_lock``：清掉过期 / 超限的条目。"""
    now = time.monotonic()
    for key in [k for k, at in _cancelled.items() if now - at > _TTL_S]:
        _cancelled.pop(key, None)
    if len(_cancelled) > _MAX_ENTRIES:
        oldest = sorted(_cancelled.items(), key=lambda kv: kv[1])
        for key, _ in oldest[: len(_cancelled) // 2]:
            _cancelled.pop(key, None)


__all__ = [
    "TurnCancelled",
    "bind_turn",
    "cancel_probe",
    "cancel_turn",
    "clear_turn",
    "current_turn_id",
    "is_cancelled",
    "raise_if_cancelled",
]
