"""细粒度权限：声明式规则 + 运营级配额（批次 3 §3.2）。

设计要点（都是刻意的，改之前先读）：

- 规则放 ``<data>/permissions.json``，用户可直接编辑；**改坏不会静默放行**——
  解析失败退回「无规则 + normal」，错误通过 ``/api/permissions`` 与设置页暴露，
  并写一条审计事件（``permission.config``）。
- 判定按规则**顺序**取第一条命中（列表顺序即优先级）；未命中时 ``strict`` 模式
  返回 ``ask``（未知工具默认最小权限），``normal`` 模式返回 ``allow``
  （空策略 = 3.2 之前的老行为，回滚只需删文件）。
- 规则只描述「什么情况下生效」，不描述工具实现；参数级条件目前三种：
  路径前缀（``session:`` 相对约定 + 否定式 ``path_not_prefix``）、URL 主机域名、
  SQL 只读。复杂逻辑请拆多条规则，不要把 DSL 做复杂。
- 拦截放在 ReAct 中间件（``graphs/common.py::permission_gate_middleware``）：
  ``ask`` 复用 ``mcps/approval.py::request_approval``，不新增弹窗通道。
"""

from __future__ import annotations

import json
import os
import re
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, ValidationError

Effect = Literal["allow", "ask", "deny"]
Mode = Literal["normal", "strict"]

#: 各工具里表示「文件/目录」的参数名（工具之间不统一，只能列全）。
_PATH_KEYS = frozenset(
    {
        "path",
        "paths",
        "file",
        "file_path",
        "filepath",
        "filename",
        "source",
        "src",
        "dest",
        "dst",
        "destination",
        "target",
        "directory",
        "dir",
        "output",
        "output_path",
        "workdir",
        "cwd",
    }
)
_URL_KEYS = frozenset({"url", "urls", "uri", "link", "endpoint", "target_url"})
_SQL_KEYS = frozenset({"sql", "query", "statement"})
_READ_ONLY_SQL = re.compile(r"^\s*(?:select|explain|pragma|with)\b", re.IGNORECASE)

_DEFAULT_QUOTA = {
    "max_per_tool_per_conversation": 0,
    "max_per_turn_tool_calls": 0,
}


class PermissionRule(BaseModel):
    """一条声明式权限规则。

    ``effect`` 是命中后的动作；``tool`` 支持 ``*`` 通配（``mcp-*`` 之类）。
    ``path_prefix`` / ``url_host_in`` / ``read_only`` 同时给出时必须**全部**满足。
    """

    model_config = ConfigDict(extra="forbid")

    id: str = ""
    effect: Effect = "deny"
    tool: str = "*"
    path_prefix: str | None = None
    path_not_prefix: str | None = None
    url_host_in: list[str] | None = None
    read_only: bool | None = None
    note: str = ""


class QuotaConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    max_per_tool_per_conversation: int = Field(default=0, ge=0)
    max_per_turn_tool_calls: int = Field(default=0, ge=0)


class PermissionConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: Mode = "normal"
    rules: list[PermissionRule] = Field(default_factory=list)
    quota: QuotaConfig = Field(default_factory=QuotaConfig)


@dataclass(frozen=True)
class Decision:
    """一次权限判定结果（``by`` 说明是谁定的，便于审计回放）。"""

    effect: Effect
    reason: str
    by: str = "default"


# --------------------------------------------------------------------------- #
# 配置加载
# --------------------------------------------------------------------------- #

_lock = threading.Lock()
_cache: tuple[tuple[int, int], PermissionConfig] | None = None
_last_error: str = ""
_stale_noted_at: tuple[int, int] | None = None


def permissions_path() -> Path:
    """``CHATVEIN_PERMISSIONS_PATH`` > 主库同目录 ``permissions.json``。"""
    explicit = (os.environ.get("CHATVEIN_PERMISSIONS_PATH") or "").strip()
    if explicit:
        return Path(explicit).expanduser()
    from db import resolve_db_path  # pyright: ignore[reportImplicitRelativeImport]

    return resolve_db_path().with_name("permissions.json")


def mode() -> Mode:
    """环境变量优先（运维临时收紧无需改文件）。"""
    raw = (os.environ.get("CHATVEIN_PERMISSION_MODE") or "").strip().lower()
    if raw in {"strict", "normal"}:
        return raw  # type: ignore[return-value]
    return _config().mode


def _parse(payload: Any) -> PermissionConfig:
    if isinstance(payload, str):
        payload = json.loads(payload)
    if not isinstance(payload, dict):
        raise ValueError("permissions.json 顶层必须是对象")
    return PermissionConfig.model_validate(payload)


def _fail_reason(exc: Exception) -> str:
    if isinstance(exc, ValidationError):
        parts: list[str] = []
        for err in exc.errors():
            loc = ".".join(str(p) for p in err.get("loc") or ()) or "(顶层)"
            parts.append(f"{loc}: {err.get('msg') or '不合法'}")
        return "；".join(parts)
    if isinstance(exc, json.JSONDecodeError):
        return f"JSON 语法错误：第 {exc.lineno} 行第 {exc.colno} 列 {exc.msg}"
    return str(exc) or type(exc).__name__


def _config() -> PermissionConfig:
    """按 mtime + size 缓存；文件不存在 / 解析失败都退回空配置。"""
    global _cache, _last_error, _stale_noted_at
    path = permissions_path()
    try:
        stat = path.stat()
        stamp = (int(stat.st_mtime_ns), stat.st_size)
    except OSError:
        stamp = (0, 0)
    with _lock:
        if _cache is not None and _cache[0] == stamp:
            return _cache[1]
    cfg = PermissionConfig()
    error = ""
    if stamp != (0, 0):
        try:
            cfg = _parse(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            error = _fail_reason(exc)
            cfg = PermissionConfig()
    with _lock:
        _cache = (stamp, cfg)
        _last_error = error
        notify = bool(error) and _stale_noted_at != stamp
        if notify:
            _stale_noted_at = stamp
    if notify:
        # 只记一次（按文件版本），避免每轮工具调用都刷一条审计。
        try:
            from .audit import record_event  # pyright: ignore[reportImplicitRelativeImport]

            record_event(
                "permission.config",
                scope=str(path),
                args={"file": str(path)},
                result_code="INVALID",
                decision="deny",
                decision_by="config",
            )
        except Exception:  # noqa: BLE001 - 审计不影响判定
            pass
    return cfg


def config_error() -> str:
    """最近一次解析错误（空字符串表示正常）。"""
    _config()
    return _last_error


def rules() -> list[PermissionRule]:
    return list(_config().rules)


def quota_config() -> QuotaConfig:
    return _config().quota


def config_view() -> dict[str, Any]:
    """给设置页 / API 用的完整视图（规则带稳定 id）。"""
    cfg = _config()
    path = permissions_path()
    items: list[dict[str, Any]] = []
    for index, rule in enumerate(cfg.rules):
        item = rule.model_dump(exclude_none=True)
        item["id"] = item.get("id") or f"rule_{index + 1}"
        items.append(item)
    return {
        "mode": mode(),
        "env_mode": bool((os.environ.get("CHATVEIN_PERMISSION_MODE") or "").strip()),
        "rules": items,
        "quota": cfg.quota.model_dump(),
        "path": str(path),
        "exists": path.is_file(),
        "error": config_error(),
    }


def save_config(payload: dict[str, Any]) -> dict[str, Any]:
    """校验后原子写盘（先写 ``.tmp`` 再 replace，避免半截文件）。

    校验失败抛 ``ValueError``（HTTP 层翻 400），**不写盘、不生效**。
    """
    global _cache
    cfg = _parse(payload)
    path = permissions_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    text = json.dumps(cfg.model_dump(exclude_none=True), ensure_ascii=False, indent=2) + "\n"
    tmp.write_text(text, encoding="utf-8", newline="\n")
    tmp.replace(path)
    with _lock:
        _cache = None
    return config_view()


# --------------------------------------------------------------------------- #
# 规则匹配
# --------------------------------------------------------------------------- #

_regex_cache: dict[str, re.Pattern[str]] = {}


def _compile(pattern: str) -> re.Pattern[str]:
    """把 ``*`` / ``**`` / ``?`` 转正则；``**`` 跨目录，``*`` 不跨。"""
    hit = _regex_cache.get(pattern)
    if hit is not None:
        return hit
    out: list[str] = []
    i = 0
    while i < len(pattern):
        ch = pattern[i]
        if ch == "*":
            if pattern[i + 1 : i + 2] == "*":
                out.append(".*")
                i += 2
                continue
            out.append("[^/]*")
            i += 1
            continue
        if ch == "?":
            out.append("[^/]")
            i += 1
            continue
        out.append(re.escape(ch))
        i += 1
    flags = re.IGNORECASE if os.name == "nt" else 0
    compiled = re.compile("^" + "".join(out) + "$", flags)
    _regex_cache[pattern] = compiled
    return compiled


def _tool_matches(pattern: str, tool: str) -> bool:
    text = (pattern or "*").strip() or "*"
    if text == "*":
        return True
    if any(ch in text for ch in "*?"):
        return bool(_compile(text).match(tool))
    return text == tool


def _session_root() -> Path | None:
    try:
        from .sandbox import current_sandbox  # pyright: ignore[reportImplicitRelativeImport]

        return current_sandbox().resolve()
    except Exception:  # noqa: BLE001 - 离线 / HTTP 线程没有会话
        return None


def _arg_values(args: dict[str, Any], keys: frozenset[str]) -> list[str]:
    out: list[str] = []
    for key, value in (args or {}).items():
        if str(key).lower() not in keys:
            continue
        if isinstance(value, str) and value.strip():
            out.append(value.strip())
        elif isinstance(value, (list, tuple)):
            out.extend(str(v).strip() for v in value if isinstance(v, str) and str(v).strip())
    return out


def _path_forms(raw: str) -> tuple[str, str]:
    """返回 ``(会话内相对 posix 路径 或 '', 绝对 posix 路径)``。"""
    root = _session_root()
    candidate = Path(raw)
    target = candidate if candidate.is_absolute() else (
        (root / candidate) if root is not None else Path(raw)
    )
    try:
        resolved = target.resolve()
    except OSError:  # pragma: no cover - 极端路径
        resolved = target
    absolute = resolved.as_posix()
    if root is None:
        return "", absolute
    try:
        rel = resolved.relative_to(root).as_posix()
    except ValueError:
        return "", absolute
    return rel, absolute


def _prefix_matches(pattern: str, rel: str, absolute: str) -> bool:
    text = (pattern or "").strip()
    if not text:
        return True
    if text.startswith("session:"):
        if not rel:
            return False
        return bool(_compile(text[len("session:") :].replace("\\", "/")).match(rel))
    return bool(_compile(text.replace("\\", "/")).match(absolute))


def _paths_match(rule: PermissionRule, args: dict[str, Any]) -> bool:
    if rule.path_prefix is None and rule.path_not_prefix is None:
        return True
    raws = _arg_values(args, _PATH_KEYS)
    if not raws:
        return False
    forms = [_path_forms(raw) for raw in raws]
    if rule.path_prefix is not None and not all(
        _prefix_matches(rule.path_prefix, rel, absolute) for rel, absolute in forms
    ):
        return False
    if rule.path_not_prefix is not None and any(
        _prefix_matches(rule.path_not_prefix, rel, absolute) for rel, absolute in forms
    ):
        return False
    return True


def _urls_match(rule: PermissionRule, args: dict[str, Any]) -> bool:
    if rule.url_host_in is None:
        return True
    allowed = [str(item).strip().lower() for item in rule.url_host_in if str(item).strip()]
    if not allowed:
        return False
    values = _arg_values(args, _URL_KEYS) or [
        str(v) for v in (args or {}).values() if isinstance(v, str) and "://" in v
    ]
    if not values:
        return False
    for raw in values:
        try:
            host = (urlparse(raw).hostname or "").lower()
        except ValueError:  # pragma: no cover
            continue
        if not host:
            continue
        for item in allowed:
            bare = item[2:] if item.startswith("*.") else item
            if host == bare or host.endswith("." + bare):
                return True
    return False


def _sql_match(rule: PermissionRule, args: dict[str, Any]) -> bool:
    if rule.read_only is None:
        return True
    statements = _arg_values(args, _SQL_KEYS)
    if not statements:
        return False
    looks_read_only = all(bool(_READ_ONLY_SQL.match(text)) for text in statements)
    return looks_read_only is bool(rule.read_only)


def _matches(rule: PermissionRule, tool: str, args: dict[str, Any]) -> bool:
    return (
        _tool_matches(rule.tool, tool)
        and _paths_match(rule, args)
        and _urls_match(rule, args)
        and _sql_match(rule, args)
    )


def _label(rule: PermissionRule, index: int) -> str:
    return rule.id.strip() or f"rule_{index + 1}"


def _reason(rule: PermissionRule, label: str) -> str:
    note = rule.note.strip()
    return f"{note}（规则 {label}）" if note else f"规则 {label}"


def check(tool: str, args: dict[str, Any] | None = None) -> Decision:
    """判定一次工具调用。异常一律放行（权限设施坏了不能把整个应用锁死）。"""
    try:
        cfg = _config()
        current = mode()
        payload = args if isinstance(args, dict) else {}
        for index, rule in enumerate(cfg.rules):
            if _matches(rule, tool, payload):
                label = _label(rule, index)
                return Decision(rule.effect, _reason(rule, label), f"rule:{label}")
        if current == "strict":
            return Decision(
                "ask",
                "strict 模式：未命中任何规则的工具体调用需要确认",
                "mode:strict",
            )
        return Decision("allow", "未命中任何规则，normal 模式放行", "mode:normal")
    except Exception as exc:  # noqa: BLE001
        return Decision("allow", f"权限检查异常，已放行：{exc}", "fallback")


def static_deny(tool: str) -> Decision | None:
    """不含参数条件的 deny 规则：可以在解析阶段就把工具摘掉。

    ``resolve_tools`` 用它做预过滤（模型连看到这个工具的机会都没有）；
    带参数条件的规则只能等到执行时才知道参，不能在这里拦。
    """
    try:
        cfg = _config()
        for index, rule in enumerate(cfg.rules):
            if rule.effect != "deny":
                continue
            if any(
                item is not None
                for item in (rule.path_prefix, rule.path_not_prefix, rule.url_host_in, rule.read_only)
            ):
                continue
            if _tool_matches(rule.tool, tool):
                label = _label(rule, index)
                return Decision("deny", _reason(rule, label), f"rule:{label}")
    except Exception:  # noqa: BLE001
        return None
    return None


# --------------------------------------------------------------------------- #
# 配额
# --------------------------------------------------------------------------- #


@dataclass
class QuotaGuard:
    """按「会话 + 工具」与「本轮总调用」计数，超限拒绝（进程内计数，重启清零）。"""

    counts: dict[tuple[str, str], int] = field(default_factory=dict)
    turn_counts: dict[str, int] = field(default_factory=dict)
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def _scope(self) -> str:
        root = _session_root()
        return root.name if root is not None else "global"

    def _turn(self) -> str:
        try:
            from agents.cancellation import current_turn_id  # pyright: ignore[reportImplicitRelativeImport]

            return current_turn_id() or ""
        except Exception:  # noqa: BLE001
            return ""

    def consume(self, tool: str) -> Decision | None:
        """执行前调用；超限返回 deny 决策，未超限返回 ``None`` 并已计数。"""
        try:
            cfg = _config().quota
        except Exception:  # noqa: BLE001
            return None
        per_conversation = int(cfg.max_per_tool_per_conversation or 0)
        per_turn = int(cfg.max_per_turn_tool_calls or 0)
        if per_conversation <= 0 and per_turn <= 0:
            return None
        scope = self._scope()
        turn = self._turn()
        with self._lock:
            if per_turn > 0 and turn:
                used = self.turn_counts.get(turn, 0)
                if used >= per_turn:
                    return Decision(
                        "deny",
                        f"本轮工具调用已达上限 {per_turn} 次，请先基于已有结果作答",
                        "quota:turn",
                    )
            key = (scope, tool)
            if per_conversation > 0 and self.counts.get(key, 0) >= per_conversation:
                return Decision(
                    "deny",
                    f"工具 {tool} 本次会话已调用 {per_conversation} 次（配额上限）",
                    "quota:tool",
                )
            if per_turn > 0 and turn:
                self.turn_counts[turn] = self.turn_counts.get(turn, 0) + 1
            if per_conversation > 0:
                self.counts[key] = self.counts.get(key, 0) + 1
        return None

    def reset(self) -> None:
        with self._lock:
            self.counts.clear()
            self.turn_counts.clear()


_quota = QuotaGuard()


def consume_quota(tool: str) -> Decision | None:
    return _quota.consume(tool)


def reset() -> None:
    """测试用：清缓存、清错误、清配额。"""
    global _cache, _last_error, _stale_noted_at
    with _lock:
        _cache = None
        _last_error = ""
        _stale_noted_at = None
    _regex_cache.clear()
    _quota.reset()


__all__ = [
    "Decision",
    "Effect",
    "Mode",
    "PermissionConfig",
    "PermissionRule",
    "QuotaConfig",
    "QuotaGuard",
    "check",
    "config_error",
    "config_view",
    "consume_quota",
    "mode",
    "permissions_path",
    "quota_config",
    "reset",
    "rules",
    "save_config",
    "static_deny",
]
