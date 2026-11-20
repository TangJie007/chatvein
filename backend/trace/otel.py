"""可选的 OpenTelemetry 导出：把一轮的 span 树映射成 OTel Span。

默认关闭，且**不随安装包分发 SDK**：`CHATVEIN_OTEL=1` 时才尝试 import
`opentelemetry-sdk`，缺依赖就静默跳过（`pip install opentelemetry-sdk` 即可）。
导出失败一律吞掉——可观测性不能反过来打断对话。

时间轴：追踪里每步有 ``start_ms``（相对本轮起点）与 ``elapsed_ms``，这里换算成
绝对时间戳，OTel 上的瀑布图与面板一致，而不是「导出瞬间一起结束」。
"""

from __future__ import annotations

import json
import os
import threading
import time
from typing import Any

_LOCK = threading.Lock()
_TRACER: Any = None
_UNAVAILABLE = False


def _env(name: str, default: str = "") -> str:
    return str(os.environ.get(name, default)).strip()


def enabled() -> bool:
    """``CHATVEIN_OTEL=0``（默认）时不碰 OTel，连 import 都不做。"""
    value = _env("CHATVEIN_OTEL", "0").lower()
    return value not in ("", "0", "false", "off", "no")


def _tracer() -> Any:
    global _TRACER, _UNAVAILABLE
    if _TRACER is not None:
        return _TRACER
    if _UNAVAILABLE:
        return None
    with _LOCK:
        if _TRACER is not None:
            return _TRACER
        if _UNAVAILABLE:
            return None
        try:
            from opentelemetry import trace
            from opentelemetry.sdk.trace import TracerProvider
            from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter
        except Exception:  # noqa: BLE001 - 依赖缺失只降级，不报错
            _UNAVAILABLE = True
            print("CHATVEIN_OTEL skipped: opentelemetry-sdk 未安装", flush=True)
            return None
        provider = TracerProvider()
        endpoint = _env("CHATVEIN_OTEL_ENDPOINT")
        exporter: Any
        if endpoint:
            try:
                from opentelemetry.exporter.otlp.proto.http.trace_exporter import (
                    OTLPSpanExporter,
                )

                exporter = OTLPSpanExporter(endpoint=endpoint)
            except Exception:  # noqa: BLE001 - 缺 OTLP 导出器就退回控制台
                exporter = ConsoleSpanExporter()
        else:
            exporter = ConsoleSpanExporter()
        provider.add_span_processor(BatchSpanProcessor(exporter))
        try:
            trace.set_tracer_provider(provider)
        except Exception:  # noqa: BLE001 - 宿主已设 provider 时沿用宿主的
            pass
        _TRACER = trace.get_tracer("chatvein")
        return _TRACER


def _clip(value: Any, limit: int = 400) -> str:
    if value is None:
        return ""
    if not isinstance(value, str):
        try:
            value = json.dumps(value, ensure_ascii=False, default=str)
        except Exception:  # noqa: BLE001
            value = str(value)
    text = str(value)
    return text if len(text) <= limit else f"{text[:limit]}…"


def _status_of(step: dict[str, Any]) -> str:
    return str(step.get("status") or "ok").lower()


def export_turn(payload: dict[str, Any], *, turn_id: str | None = None) -> bool:
    """导出一轮。返回是否真的发出（未启用 / 无依赖 / 失败都返回 ``False``）。"""
    if not enabled():
        return False
    tracer = _tracer()
    if tracer is None:
        return False
    try:
        _export(tracer, payload, turn_id=turn_id)
        return True
    except Exception as exc:  # noqa: BLE001 - 导出失败不能影响对话
        print(f"CHATVEIN_OTEL export failed: {exc}", flush=True)
        return False


def _export(tracer: Any, payload: dict[str, Any], *, turn_id: str | None) -> None:
    started = time.time_ns() - max(0, int(payload.get("elapsed_ms") or 0)) * 1_000_000
    base = started

    root = tracer.start_span("chatvein.turn", start_time=base)
    totals = payload.get("totals") if isinstance(payload.get("totals"), dict) else {}
    root.set_attribute("chatvein.turn.id", str(turn_id or payload.get("turn_id") or ""))
    root.set_attribute("chatvein.difficulty", str(payload.get("difficulty") or "unknown"))
    root.set_attribute("chatvein.status", str(payload.get("status") or "done"))
    root.set_attribute("chatvein.input", _clip(payload.get("input"), 120))
    root.set_attribute("chatvein.role_name", str(payload.get("role_name") or ""))
    root.set_attribute("chatvein.model", str(payload.get("model_name") or ""))
    for key in ("total_tokens", "input_tokens", "output_tokens"):
        root.set_attribute(f"chatvein.tokens.{key}", int(totals.get(key) or 0))
    for key in ("llm_calls", "tool_calls"):
        root.set_attribute(f"chatvein.{key}", int(totals.get(key) or 0))
    if payload.get("elapsed_ms"):
        root.set_attribute("chatvein.elapsed_ms", int(payload.get("elapsed_ms") or 0))

    live: dict[str, Any] = {}
    pending: list[tuple[Any, dict[str, Any], int]] = []
    for step in payload.get("steps") or []:
        if not isinstance(step, dict):
            continue
        parent_id = str(step.get("parent_id") or "")
        parent = live.get(parent_id, root)
        offset_ms = int(step.get("start_ms") or 0)
        start_ns = base + max(0, offset_ms) * 1_000_000
        span = tracer.start_span(
            f"chatvein.{step.get('kind') or 'step'}.{step.get('name') or 'unknown'}",
            parent=parent,
            start_time=start_ns,
        )
        span.set_attribute("chatvein.step.id", str(step.get("id") or ""))
        span.set_attribute("chatvein.step.kind", str(step.get("kind") or ""))
        span.set_attribute("chatvein.step.name", str(step.get("name") or ""))
        span.set_attribute("chatvein.step.status", _status_of(step))
        if step.get("arguments") is not None:
            span.set_attribute("chatvein.tool.arguments", _clip(step.get("arguments")))
        if step.get("error"):
            span.set_attribute("chatvein.error", _clip(step.get("error"), 200))
        usage = step.get("usage") if isinstance(step.get("usage"), dict) else None
        if usage:
            span.set_attribute("chatvein.step.input_tokens", int(usage.get("input_tokens") or 0))
            span.set_attribute("chatvein.step.output_tokens", int(usage.get("output_tokens") or 0))
        live[str(step.get("id") or "")] = span
        pending.append((span, step, start_ns))

    # 先收尾子 span 再收尾根：OTel 的隐式 context 是栈，逆序 end 才不会留悬挂。
    for span, step, start_ns in reversed(pending):
        _finish(span, step, start_ns)
    _finish(root, {"status": str(payload.get("status") or "done")}, base)


def _finish(span: Any, step: dict[str, Any], start_ns: int) -> None:
    status = _status_of(step)
    if status in ("error", "cancelled"):
        try:
            from opentelemetry.trace import Status, StatusCode

            span.set_status(Status(StatusCode.ERROR, status))
        except Exception:  # noqa: BLE001
            pass
    end_ns = start_ns + max(0, int(step.get("elapsed_ms") or 0)) * 1_000_000
    try:
        span.end(end_time=end_ns)
    except TypeError:
        span.end()
