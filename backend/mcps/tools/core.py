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
    """获取指定时区的当前日期与时间（对齐 mcp-server-time）。

    ``timezone`` 填 IANA 时区名（如 ``Asia/Shanghai``、``America/New_York``）；
    留空则用本机时区。返回 JSON：``timezone`` / ``datetime``（ISO-8601，精确到秒）/ ``is_dst``。

    示例：
    - 用户问「现在几点」→ ``get_current_time("")``
      → ``{"timezone": "Asia/Shanghai", "datetime": "2026-09-24T14:05:30+08:00", "is_dst": false}``
    - 用户问「纽约现在几点」→ ``get_current_time("America/New_York")``
      → ``{"timezone": "America/New_York", "datetime": "2026-09-24T02:05:30-04:00", "is_dst": true}``

    不要用它做日期推算或时区换算，那种情况用 ``convert_time``。
    """
    label = (timezone or "").strip() or _local_tz_name()
    try:
        tz = _zone(timezone)
        return json.dumps(_snapshot(tz, label), ensure_ascii=False)
    except ValueError as exc:
        return str(exc)


@tool
def convert_time(source_timezone: str, time: str, target_timezone: str) -> str:
    """把一个时区的时刻换算到另一个时区（对齐 mcp-server-time 的 convert_time）。

    参数：``source_timezone`` / ``target_timezone`` 均为 IANA 时区名；``time`` 为 24 小时制
    ``HH:MM``，按源时区的「今天」解析。返回 JSON：源与目标各自的 ``timezone`` / ``datetime``，
    以及 ``time_difference``（如 ``"+12h"``）。

    示例：
    - 用户问「北京早上 9 点是纽约几点」→ ``convert_time("Asia/Shanghai", "09:00", "America/New_York")``
      → 目标为前一天 ``21:00``，``time_difference`` 为 ``"-12h"``
    - 用户问「伦敦 18:00 对应我这边几点」→ ``convert_time("Europe/London", "18:00", "Asia/Shanghai")``
      → 目标为次日 ``01:00``，``time_difference`` 为 ``"+7h"``

    只处理时刻换算，不处理日期加减（如「三天后」需你自己算好日期再用本工具）。
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
    """计算纯算术表达式，返回数值字符串。

    只支持数字与 ``+ - * / ** %`` 和括号（``**`` 为幂、``%`` 为取余）。
    不支持函数调用、变量、字符串与属性访问；带单位或中文请先转成纯数字算式。

    示例：
    - 用户问「(1+2)*3 等于多少」→ ``calculator("(1+2)*3")`` → ``9.0``
    - 用户问「128 的 30% 是多少」→ ``calculator("128*0.3")`` → ``38.4``

    只做数值求值；推导过程、单位换算说明与代数求解请自己完成，再把最终算式交给本工具。
    """
    try:
        value = _eval_arith(ast.parse(expression.strip(), mode="eval"))
    except Exception as exc:  # noqa: BLE001
        return f"计算失败: {exc}"
    return str(value)


@tool
def get_system_info() -> str:
    """查看运行 ChatVein 的这台机器的概况，无需参数。

    返回 JSON：``os`` / ``os_release`` / ``arch`` / ``hostname`` / ``cpu_count`` / ``python`` /
    ``local_timezone`` / ``workspace``（主空间绝对路径）/ ``workspace_disk``（总容量与剩余，
    单位字节）/ ``data_dir`` / ``data_disk``。

    示例：
    - 用户问「我这台机器什么系统、几核」→ ``get_system_info()``
      → ``{"os": "Windows", "arch": "AMD64", "cpu_count": 16, "python": "3.13.0", ...}``
    - 用户问「工作区还剩多少空间」→ ``get_system_info()`` 后读 ``workspace_disk.free_bytes``

    磁盘数值单位是字节，回答前请换算成 KB / MB / GB。
    """
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
    """查看 ChatVein 本地 SQLite 的概况，无需参数。

    返回一行文本：``path``（库文件绝对路径）、``schema`` 版本、``conversations``（会话数）、
    ``messages``（消息数）。

    示例：
    - 用户问「数据库里有多少会话」→ ``db_stats()``
      → ``path=E:/project/chatvein/backend/data/chatvein.db schema=v3 conversations=12 messages=86``
    - 用户问「库文件在哪、多大」→ 先 ``db_stats()`` 取 ``path``，再用文件系统工具查大小

    只给概况，不查表内容；要看表结构或跑 SELECT 请用 SQLite 分组的只读工具。
    """
    info = db.info()
    return (
        f"path={info.get('path')} schema=v{info.get('schema_version')} "
        f"conversations={info.get('conversations')} messages={info.get('messages')}"
    )


@tool
def list_configured_models() -> str:
    """列出用户已在「模型」页配置好的大语言模型，无需参数。

    每行一个模型，格式为 ``- 名称 (model_id)``；一个都没配时返回「尚未配置任何模型」。

    示例：
    - 用户问「我现在配了哪些模型」→ ``list_configured_models()``
      → 两行结果：``- 主模型 (gpt-4o-mini)`` 和 ``- 深度思考 (deepseek-chat)``
    - 用户问「为什么不能回答」→ 用它确认是否有模型；返回「尚未配置任何模型」时，
      提示用户先到「模型」页添加模型并在「角色」页绑定

    只列名称与模型 id；不含 API Key、温度等细节，也不负责切换当前使用的模型。
    """
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
