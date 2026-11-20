"""追踪聚合指标：把 ``turn_traces`` 摘要压成趋势、健康度与告警。

只读、查询时计算、不落库：指标是「由已有追踪推导出来的视图」，再建一张
``trace_metrics`` 表只会带来清理和漂移问题（见 production-design-batch3.md §3.3）。

输出字段与前端 ``ConversationMetrics``（``src/api/traces.ts``）一一对应，改字段要两边一起改。
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

METRICS_SCHEMA_VERSION = 1
#: 默认看多少天、回看多少轮工具明细；service / controller / 前端都用这一处口径。
DEFAULT_WINDOW_DAYS = 14
DEFAULT_SCAN_TURNS = 100
#: 样本太少时告警只会是噪音（比如刚建会话第一轮就超时）。
MIN_TURNS_FOR_ALERT = 5

# 告警阈值只在这里定义（前端只展示，不自己算，见 AGENTS.md 硬约定 28）。
ERROR_RATE_CRITICAL = 0.4
ERROR_RATE_WARN = 0.2
CANCEL_RATE_WARN = 0.3
TOOL_FAILURE_RATE_WARN = 0.5

#: 状态只有这四桶；未知状态归 ``error``，宁可算失败也别静默当成功。
STATUS_BUCKETS = ("done", "cancelled", "running", "error")


def _p95(values: list[int]) -> int:
    """最近秩（nearest-rank）P95：取排序后第 ``ceil(0.95*n)`` 个值，不插值。"""
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
    return text if text in STATUS_BUCKETS else "error"


def _totals_of(row: dict[str, Any]) -> dict[str, Any]:
    """取一行的 ``totals``；坏数据（不是对象）一律当空，避免后面 ``.get`` 崩掉整个接口。"""
    totals = row.get("totals")
    return totals if isinstance(totals, dict) else {}


def _bucket_counts(rows: list[dict[str, Any]]) -> dict[str, int]:
    counts = dict.fromkeys(STATUS_BUCKETS, 0)
    for row in rows:
        counts[_status_bucket(str(row.get("status") or "done"))] += 1
    return counts


def _elapsed_of(row: dict[str, Any]) -> int:
    return max(0, int(row.get("elapsed_ms") or 0))


def _tokens_of(row: dict[str, Any]) -> int:
    return max(0, int(_totals_of(row).get("total_tokens") or 0))


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


def _overall(rows: list[dict[str, Any]], stats: dict[str, Any]) -> dict[str, Any]:
    """整体健康度。``stats`` 是 ``merge_tool_stats`` 的结果；没数到工具就不报工具失败率。"""
    turns = len(rows)
    counts = _bucket_counts(rows)
    overall: dict[str, Any] = {
        "turns": turns,
        "done": counts["done"],
        "cancelled": counts["cancelled"],
        "error": counts["error"],
        "running": counts["running"],
        "success_rate": _rate(counts["done"], turns),
        "cancel_rate": _rate(counts["cancelled"], turns),
        "error_rate": _rate(counts["error"], turns),
        "avg_elapsed_ms": int(sum(_elapsed_of(row) for row in rows) / turns) if turns else 0,
        "p95_elapsed_ms": _p95([_elapsed_of(row) for row in rows]),
        "avg_tokens": int(sum(_tokens_of(row) for row in rows) / turns) if turns else 0,
        "p95_tokens": _p95([_tokens_of(row) for row in rows]),
        "llm_calls": sum(int(_totals_of(row).get("llm_calls") or 0) for row in rows),
        "tool_calls": sum(int(_totals_of(row).get("tool_calls") or 0) for row in rows),
    }
    if stats:
        overall["tool_failures"] = int(stats.get("failures") or 0)
        overall["tool_failure_rate"] = _rate(
            int(stats.get("failures") or 0), int(stats.get("calls") or 0)
        )
    return overall


def _day_rows(rows: list[dict[str, Any]], *, window: int, moment: datetime) -> list[dict[str, Any]]:
    """按 UTC 日期分桶。

    窗口「最近 N 天」含今天和第 N 天前，所以是 ``window+1`` 列；没有数据的日期补 0，
    让前端图表有连续横轴。
    """
    by_day: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        day = _day_of(str(row.get("created_at") or ""))
        if day:
            by_day.setdefault(day, []).append(row)

    start = (moment - timedelta(days=window)).date()
    out: list[dict[str, Any]] = []
    for offset in range(window + 1):
        date = (start + timedelta(days=offset)).isoformat()
        chunks = by_day.get(date, [])
        count = len(chunks)
        counts = _bucket_counts(chunks)
        out.append(
            {
                "date": date,
                "turns": count,
                "done": counts["done"],
                "error": counts["error"],
                "cancelled": counts["cancelled"],
                "success_rate": _rate(counts["done"], count),
                "avg_tokens": int(sum(_tokens_of(row) for row in chunks) / count) if count else 0,
                "p95_tokens": _p95([_tokens_of(row) for row in chunks]),
                "avg_elapsed_ms": int(sum(_elapsed_of(row) for row in chunks) / count) if count else 0,
            }
        )
    return out


def _difficulty_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """按难度（``simple`` / ``medium`` / ``hard``）看成本与成功率，按轮次多少排序。"""
    by_difficulty: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        difficulty = str(row.get("difficulty") or "unknown").strip() or "unknown"
        by_difficulty.setdefault(difficulty, []).append(row)

    out: list[dict[str, Any]] = []
    for difficulty, chunks in sorted(by_difficulty.items(), key=lambda kv: -len(kv[1])):
        count = len(chunks)
        done = _bucket_counts(chunks)["done"]
        out.append(
            {
                "difficulty": difficulty,
                "turns": count,
                "success_rate": _rate(done, count),
                "avg_tokens": int(sum(_tokens_of(row) for row in chunks) / count) if count else 0,
            }
        )
    return out


def _alerts(overall: dict[str, Any], stats: dict[str, Any]) -> list[dict[str, Any]]:
    """只在样本够多时告警，避免「第一轮就超时」这种假警报。"""
    turns = int(overall["turns"])
    if turns < MIN_TURNS_FOR_ALERT:
        return []

    alerts: list[dict[str, Any]] = []
    error_rate = overall["error_rate"]
    if error_rate >= ERROR_RATE_CRITICAL:
        alerts.append(
            {
                "code": "error_rate",
                "level": "critical",
                "value": error_rate,
                "message": f"最近 {turns} 轮里失败率 {error_rate:.0%}，先看追踪里报错的 LLM / 工具步骤。",
            }
        )
    elif error_rate >= ERROR_RATE_WARN:
        alerts.append(
            {
                "code": "error_rate",
                "level": "warn",
                "value": error_rate,
                "message": f"最近 {turns} 轮里失败率 {error_rate:.0%}，明显高于平稳水平。",
            }
        )

    cancel_rate = overall["cancel_rate"]
    if cancel_rate >= CANCEL_RATE_WARN:
        alerts.append(
            {
                "code": "cancel_rate",
                "level": "warn",
                "value": cancel_rate,
                "message": f"最近 {turns} 轮里取消率 {cancel_rate:.0%}，可能是等待过久或规划过长。",
            }
        )

    failure_rate = overall.get("tool_failure_rate")
    calls = int(stats.get("calls") or 0)
    if failure_rate is not None and calls >= MIN_TURNS_FOR_ALERT and failure_rate >= TOOL_FAILURE_RATE_WARN:
        alerts.append(
            {
                "code": "tool_failure_rate",
                "level": "warn",
                "value": failure_rate,
                "message": (
                    f"工具失败率 {failure_rate:.0%}（{int(stats.get('failures') or 0)}/{calls}），"
                    "检查路径 / 网络 / 外部 MCP。"
                ),
            }
        )
    return alerts


def compute_metrics(
    items: list[dict[str, Any]],
    *,
    days: int = DEFAULT_WINDOW_DAYS,
    tool_stats: dict[str, Any] | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """``items`` 是 ``list_turn_traces`` 的摘要（最新在前）；返回可直接 JSON 化的指标视图。

    分块职责：``_within`` 按窗口过滤 → ``_overall`` / ``_day_rows`` / ``_difficulty_rows``
    各自聚合 → ``_alerts`` 判定。工具失败率来自 ``tool_stats``（``merge_tool_stats`` 的
    结果），因为摘要里没有工具明细。
    """
    moment = now or datetime.now(timezone.utc)
    window = max(1, int(days))
    rows = _within(list(items), days=window, now=moment)
    stats = tool_stats or {}
    overall = _overall(rows, stats)
    return {
        "schema_version": METRICS_SCHEMA_VERSION,
        "generated_at": moment.replace(microsecond=0).isoformat(),
        "window_days": window,
        "overall": overall,
        "by_day": _day_rows(rows, window=window, moment=moment),
        "by_difficulty": _difficulty_rows(rows),
        "tool_by_name": list(stats.get("by_tool") or []),
        "alerts": _alerts(overall, stats),
    }
