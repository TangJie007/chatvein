"""追踪落在会话库 ``turn_traces``，不经过会话消息表。"""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator


def _iso_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


@contextmanager
def _connect(db_path: Path) -> Iterator[sqlite3.Connection]:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path), timeout=30)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def ensure_trace_table(db_path: Path) -> None:
    with _connect(db_path) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS turn_traces (
                turn_id TEXT PRIMARY KEY,
                payload_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )


def save_turn_trace(db_path: Path, turn_id: str, payload: dict[str, Any]) -> None:
    """按 turn 覆盖正文。首次写入的 ``created_at`` 保持不变。"""
    ensure_trace_table(db_path)
    body = dict(payload)
    body["turn_id"] = turn_id
    encoded = json.dumps(body, ensure_ascii=False, default=str)
    with _connect(db_path) as conn:
        conn.execute(
            "INSERT INTO turn_traces(turn_id, payload_json, created_at) VALUES (?, ?, ?) "
            "ON CONFLICT(turn_id) DO UPDATE SET payload_json = excluded.payload_json",
            (turn_id, encoded, _iso_now()),
        )


def _totals(payload: dict[str, Any]) -> dict[str, int]:
    raw = payload.get("totals") if isinstance(payload.get("totals"), dict) else {}
    totals = {
        "input_tokens": int(raw.get("input_tokens") or 0),
        "output_tokens": int(raw.get("output_tokens") or 0),
        "total_tokens": int(raw.get("total_tokens") or 0),
        "llm_calls": int(raw.get("llm_calls") or 0),
        "tool_calls": int(raw.get("tool_calls") or 0),
        "llm_ms": int(raw.get("llm_ms") or 0),
        "tool_ms": int(raw.get("tool_ms") or 0),
    }
    if raw.get("cached_tokens"):
        totals["cached_tokens"] = int(raw.get("cached_tokens") or 0)
    if raw.get("reasoning_tokens"):
        totals["reasoning_tokens"] = int(raw.get("reasoning_tokens") or 0)
    return totals


def summary_of(payload: dict[str, Any], created_at: str) -> dict[str, Any]:
    return {
        "turn_id": str(payload.get("turn_id") or ""),
        "created_at": created_at,
        "status": str(payload.get("status") or "done"),
        "input": str(payload.get("input") or "")[:120],
        "difficulty": str(payload.get("difficulty") or ""),
        "elapsed_ms": int(payload.get("elapsed_ms") or 0),
        "role_name": payload.get("role_name"),
        "model_name": payload.get("model_name"),
        "selected_tools": list(payload.get("selected_tools") or []),
        "totals": _totals(payload),
    }


def list_turn_traces(db_path: Path) -> list[dict[str, Any]]:
    if not db_path.is_file():
        return []
    ensure_trace_table(db_path)
    with _connect(db_path) as conn:
        rows = conn.execute(
            "SELECT turn_id, payload_json, created_at FROM turn_traces ORDER BY created_at DESC"
        ).fetchall()
    items: list[dict[str, Any]] = []
    for row in rows:
        try:
            payload = json.loads(str(row["payload_json"]))
        except json.JSONDecodeError:
            continue
        if not isinstance(payload, dict):
            continue
        payload.setdefault("turn_id", str(row["turn_id"]))
        items.append(summary_of(payload, str(row["created_at"])))
    return items


def get_turn_trace(db_path: Path, turn_id: str) -> dict[str, Any] | None:
    if not db_path.is_file():
        return None
    ensure_trace_table(db_path)
    with _connect(db_path) as conn:
        row = conn.execute(
            "SELECT payload_json FROM turn_traces WHERE turn_id = ?",
            (turn_id,),
        ).fetchone()
    if row is None:
        return None
    try:
        payload = json.loads(str(row["payload_json"]))
    except json.JSONDecodeError:
        return None
    return payload if isinstance(payload, dict) else None
