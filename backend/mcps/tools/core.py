"""通用小工具：时间（对齐 mcp-server-time）、计算、本机概况。

WorkBuddy 文档以 Time MCP（``mcp-server-time``）为时间能力示例；此处进程内实现同等工具，
不另起 MCP 子进程。计算与本机概况一并放在 ``core``（无独立设置卡片）。
"""

from __future__ import annotations

import ast
import json
import operator
import os
import platform
import shutil
import socket
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from langchain_core.tools import BaseTool, tool

import db  # pyright: ignore[reportImplicitRelativeImport]
from mcps.workspace import workspace_root  # pyright: ignore[reportImplicitRelativeImport]
from models.service import ModelsService  # pyright: ignore[reportImplicitRelativeImport]

_OPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.Pow: operator.pow,
    ast.USub: operator.neg,
    ast.UAdd: operator.pos,
    ast.Mod: operator.mod,
}


def _eval_arith(node: ast.AST) -> float:
    if isinstance(node, ast.Expression):
        return _eval_arith(node.body)
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return float(node.value)
    if isinstance(node, ast.UnaryOp) and type(node.op) in _OPS:
        return float(_OPS[type(node.op)](_eval_arith(node.operand)))  # type: ignore[operator]
    if isinstance(node, ast.BinOp) and type(node.op) in _OPS:
        return float(
            _OPS[type(node.op)](_eval_arith(node.left), _eval_arith(node.right))  # type: ignore[operator]
        )
    raise ValueError("仅支持数字与 + - * / ** % 运算")


def _local_tz_name() -> str:
    override = (os.environ.get("CHATVEIN_LOCAL_TIMEZONE") or "").strip()
    if override:
        return override
    local = datetime.now().astimezone().tzinfo
    key = getattr(local, "key", None)
    if isinstance(key, str) and key:
        return key
    now = datetime.now().astimezone()
    offset = now.utcoffset() or timedelta(0)
    hours = int(offset.total_seconds() // 3600)
    return f"UTC{hours:+d}"


def _zone(name: str) -> ZoneInfo | timezone:
    text = (name or "").strip()
    if not text:
        text = _local_tz_name()
    upper = text.upper()
    if upper == "UTC":
        return timezone.utc
    if upper.startswith("UTC") and len(text) <= 6:
        raw = text[3:]
        try:
            hours = int(raw) if raw else 0
            return timezone(timedelta(hours=hours))
        except ValueError as exc:
            raise ValueError(f"无法解析时区: {name}") from exc
    try:
        return ZoneInfo(text)
    except ZoneInfoNotFoundError as exc:
        raise ValueError(
            f"未知时区: {name}（请用 IANA 名，如 Asia/Shanghai；Windows 需安装 tzdata）"
        ) from exc
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"无法解析时区: {name}") from exc


def _snapshot(tz: ZoneInfo | timezone, label: str) -> dict[str, object]:
    now = datetime.now(tz)
    dst = bool(now.dst()) if now.dst() is not None else False
    return {
        "timezone": label,
        "datetime": now.isoformat(timespec="seconds"),
        "is_dst": dst,
    }


def _disk(path: Path) -> dict[str, object]:
    try:
        probe = path if path.exists() else path.anchor or path
        du = shutil.disk_usage(probe)
        return {"total_bytes": du.total, "free_bytes": du.free}
    except Exception:  # noqa: BLE001
        return {}


@tool
def get_current_time(timezone: str = "") -> str:
    """获取指定时区的当前时间（对齐 WorkBuddy / mcp-server-time）。

    ``timezone`` 为 IANA 名（如 ``Asia/Shanghai``、``America/New_York``）。
    留空则用本机时区（可用环境变量 ``CHATVEIN_LOCAL_TIMEZONE`` 覆盖）。
    """
    label = (timezone or "").strip() or _local_tz_name()
    try:
        tz = _zone(timezone)
        return json.dumps(_snapshot(tz, label), ensure_ascii=False)
    except ValueError as exc:
        return str(exc)


@tool
def convert_time(source_timezone: str, time: str, target_timezone: str) -> str:
    """在两个时区之间转换时刻（对齐 mcp-server-time 的 convert_time）。

    ``time`` 为 24 小时制 ``HH:MM``（相对「今天」）。返回源/目标时间与时差。
    """
    try:
        source_label = (source_timezone or "").strip() or _local_tz_name()
        target_label = (target_timezone or "").strip() or _local_tz_name()
        source_tz = _zone(source_timezone)
        target_tz = _zone(target_timezone)
        hour_s, minute_s = (time or "").strip().split(":", 1)
        hour, minute = int(hour_s), int(minute_s)
        if not (0 <= hour <= 23 and 0 <= minute <= 59):
            return "time 必须是 HH:MM（0–23 时，0–59 分）"
        today = datetime.now(source_tz).date()
        source_dt = datetime(
            today.year, today.month, today.day, hour, minute, tzinfo=source_tz
        )
        target_dt = source_dt.astimezone(target_tz)
        src_off = source_dt.utcoffset() or timedelta(0)
        tgt_off = target_dt.utcoffset() or timedelta(0)
        diff_h = (tgt_off - src_off).total_seconds() / 3600
        sign = "+" if diff_h >= 0 else ""
        payload = {
            "source": {
                "timezone": source_label,
                "datetime": source_dt.isoformat(timespec="seconds"),
                "is_dst": bool(source_dt.dst()) if source_dt.dst() is not None else False,
            },
            "target": {
                "timezone": target_label,
                "datetime": target_dt.isoformat(timespec="seconds"),
                "is_dst": bool(target_dt.dst()) if target_dt.dst() is not None else False,
            },
            "time_difference": f"{sign}{diff_h}h",
        }
        return json.dumps(payload, ensure_ascii=False)
    except ValueError as exc:
        return str(exc)
    except Exception as exc:  # noqa: BLE001
        return f"转换失败: {exc}"


@tool
def calculator(expression: str) -> str:
    """计算纯算术表达式，如 ``(1+2)*3``。不执行函数调用或属性访问。"""
    try:
        value = _eval_arith(ast.parse(expression.strip(), mode="eval"))
    except Exception as exc:  # noqa: BLE001
        return f"计算失败: {exc}"
    return str(value)


@tool
def get_system_info() -> str:
    """本机概况：操作系统、架构、主机名、CPU、Python、工作区与数据目录磁盘占用。"""
    data_raw = (os.environ.get("CHATVEIN_DATA_DIR") or "").strip()
    try:
        root = workspace_root()
        work = str(root)
        disk = _disk(root)
    except Exception as exc:  # noqa: BLE001
        work = f"(不可用: {exc})"
        disk = {}
    data_path = Path(data_raw).expanduser() if data_raw else None
    payload = {
        "os": platform.system(),
        "os_release": platform.release(),
        "arch": platform.machine(),
        "hostname": socket.gethostname(),
        "cpu_count": os.cpu_count(),
        "python": platform.python_version(),
        "local_timezone": _local_tz_name(),
        "workspace": work,
        "workspace_disk": disk,
        "data_dir": str(data_path) if data_path else "(默认 backend/data)",
        "data_disk": _disk(data_path) if data_path else {},
    }
    return json.dumps(payload, ensure_ascii=False)


@tool
def db_stats() -> str:
    """返回本地 ChatVein SQLite 概况（路径、schema、会话/消息数）。"""
    info = db.info()
    return (
        f"path={info.get('path')} schema=v{info.get('schema_version')} "
        f"conversations={info.get('conversations')} messages={info.get('messages')}"
    )


@tool
def list_configured_models() -> str:
    """列出已配置的 LLM。"""
    models = ModelsService().list_models()
    if not models:
        return "尚未配置任何模型"
    return "\n".join(
        f"- {m.name} ({m.model_id})" for m in models
    )


TOOLS: tuple[BaseTool, ...] = (
    get_current_time,
    convert_time,
    calculator,
    get_system_info,
    db_stats,
    list_configured_models,
)


def heuristic(text: str) -> list[str]:
    names: list[str] = []
    if any(k in text for k in ("时区", "换算时间", "convert time", "时差")):
        names.append("convert_time")
    if any(k in text for k in ("时间", "几点", "日期", "time", "date", "now", "今天几号")):
        names.append("get_current_time")
    if any(k in text for k in ("计算", "算一下", "+", "*", "calculate")):
        names.append("calculator")
    if any(
        k in text
        for k in ("本机", "系统信息", "机器概况", "system info", "主机名", "多少核", "磁盘")
    ):
        names.append("get_system_info")
    if any(k in text for k in ("数据库概况", "db 统计", "sqlite 概况")):
        names.append("db_stats")
    if any(k in text for k in ("模型列表", "有哪些模型", "list models", "llm 配置")):
        names.append("list_configured_models")
    return names
