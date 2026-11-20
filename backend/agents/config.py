"""开关的单一读取口（batch4 · 4.4）。

以前同一个「环境变量怎么判真假」的规则散在 streaming / checkpoint / otel / approval /
audit / memory 里各写一遍，默认值和判据还不一样：``CHATVEIN_AUDIT`` 认 ``!= "0"``，
``CHATVEIN_MEMORY_AUTO_ACCEPT`` 认 ``== "1"``，于是 ``=true`` 在一个开关上生效、
在另一个上被当成关。这里把口径定死：

- **没设** → 用调用点给的默认值；
- **显式设了** → ``""`` / ``0`` / ``false`` / ``no`` / ``off`` 算关，其余算开。

新开关一律 ``config.flag("CHATVEIN_XXX", default)`` / ``config.number(...)`` /
``config.decimal(...)`` / ``config.text(...)``，并同步 ``docs/配置总表.md``
（``tests/test_config.py`` 会检查文档漏没漏）。

注意：``CHATVEIN_*_PATH`` 这类「读路径」的变量不走这里，由各自模块直接读。
"""

from __future__ import annotations

import os
from typing import Final

_FALSE_WORDS: Final = frozenset({"", "0", "false", "no", "off"})


def flag(name: str, default: bool) -> bool:
    """布尔开关。``name`` 必须带 ``CHATVEIN_`` 前缀，便于在文档里 grep 到。"""
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() not in _FALSE_WORDS


def number(name: str, default: int, *, minimum: int | None = None) -> int:
    """整数开关。**写错就抛**：悄悄退回默认值会让「为什么没生效」查上一天。"""
    raw = (os.environ.get(name) or "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise ValueError(f"{name} 需要整数，当前是 {raw!r}") from exc
    if minimum is not None and value < minimum:
        raise ValueError(f"{name} 不能小于 {minimum}，当前是 {value}")
    return value


def decimal(name: str, default: float, *, minimum: float | None = None) -> float:
    """小数字开关（秒数、倍率）。与 ``number`` 同口径：**写错就抛**。"""
    raw = (os.environ.get(name) or "").strip()
    if not raw:
        return default
    try:
        value = float(raw)
    except ValueError as exc:
        raise ValueError(f"{name} 需要数字，当前是 {raw!r}") from exc
    if minimum is not None and value < minimum:
        raise ValueError(f"{name} 不能小于 {minimum}，当前是 {value}")
    return value


def text(name: str, default: str) -> str:
    """文本开关：去掉首尾空白，空值按「没设」处理（避免 ``=`` 得到空串）。"""
    raw = (os.environ.get(name) or "").strip()
    return raw or default
