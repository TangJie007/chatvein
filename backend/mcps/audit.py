"""安全审计：独立追加写库 ``audit.sqlite``（批次 3 §3.1 起用，§3.2 扩展全量工具调用）。

与业务库分离的原因：

- 审计要求「只追加、可回放」，跟业务表的 UPDATE/DELETE 语义天然冲突；
- 用户想导出 / 备份 / 清空审计时，不该碰会话与主库；
- trace 是功能追踪（给用户看思考过程），审计是安全证据（给事后查），两者受众不同。

写入失败一律吞掉：审计不能反过来把工具调用搞挂。
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from agents import config  # pyright: ignore[reportImplicitRelativeImport]

_SCHEMA = """
CREATE TABLE IF NOT EXISTS audit_events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    actor TEXT NOT NULL DEFAULT '',
    scope TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL,
    tool TEXT NOT NULL DEFAULT '',
    args_redacted TEXT NOT NULL DEFAULT '{}',
    result_code TEXT NOT NULL DEFAULT '',
    duration_ms INTEGER NOT NULL DEFAULT 0,
    decision TEXT NOT NULL DEFAULT 'allow',
    decision_by TEXT NOT NULL DEFAULT 'system'
);
CREATE INDEX IF NOT EXISTS idx_audit_tool ON audit_events(tool, seq);
"""

_MAX_LIMIT = 500

#: 参数脱敏：键名命中即整值替换；值本身像凭证也替换（双保险）。
_SENSITIVE_KEY = re.compile(
    r"(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|COOKIE|API)", re.IGNORECASE
)
_REDACTED = "***"

#: 值脱敏按顺序过一遍：先命中「键值对」再兜底裸凭证，避免 `authorization: Bearer xxx`
#: 只把 `Bearer` 打码、令牌漏出来的情况。
_INLINE_SECRETS = (
    re.compile(r"(?i)((?:sk|rk)-[A-Za-z0-9]{8,}|ghp_[A-Za-z0-9]{8,}|AKIA[0-9A-Z]{12,})"),
    re.compile(r"(?i)(authorization\s*[:=]\s*)(?:bearer\s+)?([^\s'\"]{6,})"),
    re.compile(r"(?i)((?:password|passwd|token|secret|api[_-]?key)\s*[=:]\s*)['\"]?([^\s'\"]{6,})"),
    re.compile(r"(?i)(bearer\s+[A-Za-z0-9._\-]{8,})"),
)


def mask_secrets(text: str) -> str:
    """把字符串里的凭证形态打码（用于命令、参数值）。"""
    out = text
    for pattern in _INLINE_SECRETS:
        if pattern.groups == 2:
            out = pattern.sub(lambda m: f"{m.group(1)}{_REDACTED}", out)
        else:
            out = pattern.sub(_REDACTED, out)
    return out

_initialized: set[str] = set()
_init_lock = threading.Lock()
_write_lock = threading.Lock()


def _iso_now() -> str:
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat(timespec="seconds")


def audit_enabled() -> bool:
    """默认开。``CHATVEIN_AUDIT=0`` 关闭（口径见 ``agents/config.py``；留空按关）。"""
    return config.flag("CHATVEIN_AUDIT", True)


def audit_db_path() -> Path:
    """``CHATVEIN_AUDIT_DB_PATH`` > 主库同目录的 ``audit.sqlite``（测试自动隔离）。"""
    explicit = (os.environ.get("CHATVEIN_AUDIT_DB_PATH") or "").strip()
    if explicit:
        return Path(explicit).expanduser()
    from db import resolve_db_path  # pyright: ignore[reportImplicitRelativeImport]

    return resolve_db_path().with_name("audit.sqlite")


def redact(value: Any, *, depth: int = 0) -> Any:
    """递归脱敏：键名敏感 → 整值替换；字符串像凭证 → 打码；其余原样（供回放）。"""
    if depth > 6:
        return "…"
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for key, item in value.items():
            text = str(key)
            out[text] = _REDACTED if _SENSITIVE_KEY.search(text) else redact(item, depth=depth + 1)
        return out
    if isinstance(value, (list, tuple)):
        return [redact(item, depth=depth + 1) for item in value]
    if isinstance(value, str):
        return mask_secrets(value)
    return value


def redact_args(args: Any) -> str:
    try:
        return json.dumps(redact(args), ensure_ascii=False, sort_keys=True, default=str)
    except (TypeError, ValueError):
        return "{}"


def ensure_audit_db(path: Path | None = None) -> Path:
    target = path or audit_db_path()
    key = str(target.resolve())
    if key in _initialized:
        return target
    with _init_lock:
        if key in _initialized:
            return target
        target.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(target, timeout=10, check_same_thread=False)
        try:
            conn.execute("PRAGMA journal_mode = WAL").close()
            conn.executescript(_SCHEMA)
            conn.commit()
        finally:
            conn.close()
        _initialized.add(key)
    return target


def record_event(
    action: str,
    *,
    tool: str = "",
    actor: str = "",
    scope: str = "",
    args: Any = None,
    result_code: str = "",
    duration_ms: int = 0,
    decision: str = "allow",
    decision_by: str = "system",
) -> bool:
    """写一条审计事件；失败返回 ``False``，绝不抛异常。"""
    if not audit_enabled():
        return False
    try:
        path = ensure_audit_db()
        payload = redact_args(args if args is not None else {})
        with _write_lock:
            conn = sqlite3.connect(path, timeout=10, check_same_thread=False)
            try:
                conn.execute(
                    "INSERT INTO audit_events "
                    "(ts, actor, scope, action, tool, args_redacted, result_code,"
                    " duration_ms, decision, decision_by) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        _iso_now(),
                        str(actor),
                        str(scope),
                        str(action),
                        str(tool),
                        payload,
                        str(result_code),
                        int(duration_ms),
                        str(decision),
                        str(decision_by),
                    ),
                )
                conn.commit()
            finally:
                conn.close()
        return True
    except Exception:  # noqa: BLE001 - 审计永不阻断主链路
        return False


def list_events(
    *,
    tool: str | None = None,
    action: str | None = None,
    decision: str | None = None,
    since: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    """按工具 / 动作 / 起始时间查审计事件（``seq`` 降序，即最新在前）。"""
    if not audit_enabled():
        return []
    try:
        path = ensure_audit_db()
        sql = "SELECT * FROM audit_events"
        clauses: list[str] = []
        params: list[Any] = []
        if tool:
            clauses.append("tool = ?")
            params.append(str(tool))
        if action:
            clauses.append("action = ?")
            params.append(str(action))
        if decision:
            clauses.append("decision = ?")
            params.append(str(decision))
        if since:
            clauses.append("ts >= ?")
            params.append(str(since))
        if clauses:
            sql += " WHERE " + " AND ".join(clauses)
        sql += " ORDER BY seq DESC LIMIT ?"
        params.append(max(1, min(int(limit), _MAX_LIMIT)))
        conn = sqlite3.connect(path, timeout=10, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        try:
            rows = conn.execute(sql, params).fetchall()
        finally:
            conn.close()
        out: list[dict[str, Any]] = []
        for row in rows:
            item = dict(row)
            try:
                item["args"] = json.loads(item.pop("args_redacted") or "{}")
            except json.JSONDecodeError:
                item["args"] = {}
            out.append(item)
        return out
    except Exception:  # noqa: BLE001
        return []
