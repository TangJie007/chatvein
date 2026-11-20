"""追踪聚合指标：把 ``turn_traces`` 摘要压成趋势、健康度与告警。

只读、查询时计算、不落库：指标是「由已有追踪推导出来的视图」，再建一张
``trace_metrics`` 表只会带来清理和漂移问题（见 production-design-batch3.md §3.3）。
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

SCHEMA_VERSION = 1
DEFAULT_WINDOW_DAYS = 14
#: 样本太少时告警只会是噪音（比如刚建会话第一轮就超时）。
MIN_TURNS_FOR_ALERT = 5


def _p95(values: list[int]) -> int:
    if not values:
        return 0
    ordered = sorted(values)
    index = max(0, math.ceil(0.95 * len(ordered)) - 1)
    return int(ordered[index])


def _rate(part: int, total: int) -> float:
    return round(part / total, 4) if total else 0.0


def _parse(created_at: str) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(str(created_at))
    except (TypeError, ValueError):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _day_of(created_at: str) -> str:
    """UTC 日期（``created_at`` 是 ISO 8601，前 10 位就是日期）。"""
    text = str(created_at or "")
    return text[:10] if len(text) >= 10 else ""


def _status_bucket(status: str) -> str:
    text = str(status or "done").strip().lower()
    if text == "done":
        return "done"
    if text == "cancelled":
        return "cancelled"
    if text == "running":
        return "running"
    return "error"


def count_tool_failures(payload: dict[str, Any]) -> dict[str, Any]:
    """从单轮 payload 里数工具失败。``status`` 除了 ``ok`` / ``offline`` 都算失败。"""
    calls = 0
    failures = 0
    by_tool: dict[str, list[int]] = {}
    for step in payload.get("steps") or []:
        if not isinstance(step, dict) or step.get("kind") != "tool":
            continue
        name = str(step.get("name") or "unknown")
        counters = by_tool.setdefault(name, [0, 0])
        calls += 1
        counters[0] += 1
        status = str(step.get("status") or "ok").lower()
        if status not in ("ok", "offline"):
            failures += 1
            counters[1] += 1
    return {
        "calls": calls,
        "failures": failures,
        "by_tool": [
            {"tool": name, "calls": counters[0], "failures": counters[1]}
            for name, counters in sorted(by_tool.items(), key=lambda kv: -kv[1][0])
        ],
    }


def merge_tool_stats(payloads: Iterable[dict[str, Any]]) -> dict[str, Any]:
    calls = 0
    failures = 0
    totals: dict[str, list[int]] = {}
    for payload in payloads:
        stats = count_tool_failures(payload)
        calls += int(stats["calls"])
        failures += int(stats["failures"])
        for row in stats["by_tool"]:
            counters = totals.setdefault(str(row["tool"]), [0, 0])
            counters[0] += int(row["calls"])
            counters[1] += int(row["failures"])
    return {
        "calls": calls,
        "failures": failures,
        "by_tool": [
            {"tool": name, "calls": counters[0], "failures": counters[1]}
            for name, counters in sorted(totals.items(), key=lambda kv: -kv[1][0])
        ],
    }


def _within(items: list[dict[str, Any]], *, days: int, now: datetime) -> list[dict[str, Any]]:
    cutoff = now - timedelta(days=days)
    kept: list[dict[str, Any]] = []
    for item in items:
        created = _parse(str(item.get("created_at") or ""))
        # 时间戳坏掉的条目照样算进来：宁可多算一轮，也不要静默丢数据。
        if created is None or created >= cutoff:
            kept.append(item)
    return kept


def compute_metrics(
    items: list[dict[str, Any]],
    *,
    days: int = DEFAULT_WINDOW_DAYS,
    tool_stats: dict[str, Any] | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """``items`` 是 ``list_turn_traces`` 的摘要（最新在前）。"""
    moment = now or datetime.now(timezone.utc)
    window = max(1, int(days))
    rows = _within(list(items), days=window, now=moment)

    turns = len(rows)
    buckets: dict[str, int] = {"done": 0, "cancelled": 0, "running": 0, "error": 0}
    elapsed: list[int] = []
    tokens: list[int] = []
    llm_calls = 0
    tool_calls = 0
    by_day: dict[str, list[dict[str, Any]]] = {}
    by_difficulty: dict[str, list[dict[str, Any]]] = {}

    for item in rows:
        status = str(item.get("status") or "done")
        buckets[_status_bucket(status)] += 1
        elapsed_ms = int(item.get("elapsed_ms") or 0)
        elapsed.append(max(0, elapsed_ms))
        totals = item.get("totals") if isinstance(item.get("totals"), dict) else {}
        total_tokens = int(totals.get("total_tokens") or 0)
        tokens.append(max(0, total_tokens))
        llm_calls += int(totals.get("llm_calls") or 0)
        tool_calls += int(totals.get("tool_calls") or 0)
        day = _day_of(str(item.get("created_at") or ""))
        if day:
            by_day.setdefault(day, []).append(item)
        difficulty = str(item.get("difficulty") or "unknown").strip() or "unknown"
        by_difficulty.setdefault(difficulty, []).append(item)

    stats = tool_stats or {}
    tool_failure_rate = (
        _rate(int(stats.get("failures") or 0), int(stats.get("calls") or 0))
        if stats
        else None
    )

    overall: dict[str, Any] = {
        "turns": turns,
        "done": buckets["done"],
        "cancelled": buckets["cancelled"],
        "error": buckets["error"],
        "running": buckets["running"],
        "success_rate": _rate(buckets["done"], turns),
        "cancel_rate": _rate(buckets["cancelled"], turns),
        "error_rate": _rate(buckets["error"], turns),
        "avg_elapsed_ms": int(sum(elapsed) / turns) if turns else 0,
        "p95_elapsed_ms": _p95(elapsed),
        "avg_tokens": int(sum(tokens) / turns) if turns else 0,
        "p95_tokens": _p95(tokens),
        "llm_calls": llm_calls,
        "tool_calls": tool_calls,
    }
    if tool_failure_rate is not None:
        overall["tool_failures"] = int(stats.get("failures") or 0)
        overall["tool_failure_rate"] = tool_failure_rate

    day_rows: list[dict[str, Any]] = []
    start = (moment - timedelta(days=window)).date()
    for offset in range(window + 1):
        day = (start + timedelta(days=offset)).isoformat()
        chunks = by_day.get(day, [])
        count = len(chunks)
        done = sum(1 for row in chunks if _status_bucket(str(row.get("status") or "done")) == "done")
        errors = sum(1 for row in chunks if _status_bucket(str(row.get("status") or "done")) == "error")
        cancels = sum(1 for row in chunks if _status_bucket(str(row.get("status") or "done")) == "cancelled")
        day_tokens = [int((row.get("totals") or {}).get("total_tokens") or 0) for row in chunks]
        day_elapsed = [int(row.get("elapsed_ms") or 0) for row in chunks]
        day_rows.append(
            {
                "date": day,
                "turns": count,
                "done": done,
                "error": errors,
                "cancelled": cancels,
                "success_rate": _rate(done, count),
                "avg_tokens": int(sum(day_tokens) / count) if count else 0,
                "p95_tokens": _p95([max(0, value) for value in day_tokens]),
                "avg_elapsed_ms": int(sum(day_elapsed) / count) if count else 0,
            }
        )

    difficulty_rows: list[dict[str, Any]] = []
    for difficulty, chunks in sorted(by_difficulty.items(), key=lambda kv: -len(kv[1])):
        count = len(chunks)
        done = sum(1 for row in chunks if _status_bucket(str(row.get("status") or "done")) == "done")
        chunk_tokens = [int((row.get("totals") or {}).get("total_tokens") or 0) for row in chunks]
        difficulty_rows.append(
            {
                "difficulty": difficulty,
                "turns": count,
                "success_rate": _rate(done, count),
                "avg_tokens": int(sum(chunk_tokens) / count) if count else 0,
            }
        )

    alerts: list[dict[str, Any]] = []
    if turns >= MIN_TURNS_FOR_ALERT:
        if overall["error_rate"] >= 0.4:
            alerts.append(
                {
                    "code": "error_rate",
                    "level": "critical",
                    "value": overall["error_rate"],
                    "message": f"最近 {turns} 轮里失败率 {overall['error_rate']:.0%}，先看追踪里报错的 LLM / 工具步骤。",
                }
            )
        elif overall["error_rate"] >= 0.2:
            alerts.append(
                {
                    "code": "error_rate",
                    "level": "warn",
                    "value": overall["error_rate"],
                    "message": f"最近 {turns} 轮里失败率 {overall['error_rate']:.0%}，明显高于平稳水平。",
                }
            )
        if overall["cancel_rate"] >= 0.3:
            alerts.append(
                {
                    "code": "cancel_rate",
                    "level": "warn",
                    "value": overall["cancel_rate"],
                    "message": f"最近 {turns} 轮里取消率 {overall['cancel_rate']:.0%}，可能是等待过久或规划过长。",
                }
            )
        if tool_failure_rate is not None and int(stats.get("calls") or 0) >= MIN_TURNS_FOR_ALERT and tool_failure_rate >= 0.5:
            alerts.append(
                {
                    "code": "tool_failure_rate",
                    "level": "warn",
                    "value": tool_failure_rate,
                    "message": f"工具失败率 {tool_failure_rate:.0%}（{int(stats.get('failures') or 0)}/{int(stats.get('calls') or 0)}），检查路径 / 网络 / 外部 MCP。",
                }
            )

    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": moment.replace(microsecond=0).isoformat(),
        "window_days": window,
        "overall": overall,
        "by_day": day_rows,
        "by_difficulty": difficulty_rows,
        "tool_by_name": list(stats.get("by_tool") or []),
        "alerts": alerts,
    }
