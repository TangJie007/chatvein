"""Bash 命令分级：只读命令直接跑，危险命令拒绝，其余等用户确认。"""

from __future__ import annotations

import re
import shlex
from typing import Literal

DecisionKind = Literal["allow", "ask", "deny"]

_META = set("|;&<>`$\n\r")
_DENY: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"\$\("), "不允许命令替换"),
    (re.compile(r"`"), "不允许反引号"),
    (re.compile(r"[\n\r]"), "不允许换行拼接命令"),
    (re.compile(r"(^|[;&|])\s*(sudo|su|doas)\b", re.I), "不允许提权"),
    (re.compile(r"\brm\b", re.I), "不允许 rm"),
    (re.compile(r"\b(rmdir|del|rd)\b", re.I), "不允许删除命令"),
    (re.compile(r"\b(mkfs|shutdown|reboot|diskpart)\b", re.I), "不允许磁盘或关机命令"),
    (re.compile(r"\b(chmod|chown)\b", re.I), "不允许改权限"),
    (re.compile(r"\b(curl|wget)\b", re.I), "不允许在 shell 里下载"),
    (re.compile(r"\|\s*(ba)?sh\b", re.I), "不允许把输出送进 shell"),
    (re.compile(r"\|\s*python", re.I), "不允许把输出送进 Python"),
    (re.compile(r"\b(cmd|powershell|pwsh)\b", re.I), "不允许再套一层系统 shell"),
    (re.compile(r"\bformat\b", re.I), "不允许 format"),
    (re.compile(r"[A-Za-z]:[/\\]"), "不允许访问盘符路径"),
    (re.compile(r"(?:^|[\s\"'])/[a-zA-Z]/"), "不允许 Git Bash 盘符路径"),
    (re.compile(r"\.\."), "不允许 .. 跳出目录"),
)


def classify(command: str) -> tuple[DecisionKind, str]:
    text = (command or "").strip()
    if not text:
        return "deny", "命令为空"
    if len(text) > 4000:
        return "deny", "命令过长"
    for pattern, reason in _DENY:
        if pattern.search(text):
            return "deny", reason
    if any(ch in text for ch in _META):
        return "ask", "命令含管道、重定向或连接符，需要确认"
    try:
        argv = shlex.split(text, posix=True)
    except ValueError:
        return "ask", "命令引号不完整，需要确认"
    if _auto(argv):
        return "allow", "只读或限定在会话目录内"
    return "ask", "会改动会话目录，需要确认"


def _auto(argv: list[str]) -> bool:
    if not argv:
        return False
    head = _command_name(argv[0])
    rest = argv[1:]
    if head in {"ls", "pwd", "cat", "head", "tail", "wc", "echo"}:
        return all(_safe_arg(arg) for arg in rest)
    if head == "cd":
        return len(rest) == 1 and _relative_dir(rest[0])
    if head == "git":
        return (
            len(rest) >= 1
            and rest[0] in {"status", "diff", "log", "rev-parse", "branch", "show"}
            and all(_safe_arg(arg) for arg in rest[1:])
        )
    if head in {"python", "python3"}:
        return _safe_python(rest)
    return False


def _command_name(token: str) -> str:
    name = token.replace("\\", "/").rsplit("/", 1)[-1].lower()
    if name.endswith(".exe"):
        name = name[:-4]
    return name


def _safe_arg(arg: str) -> bool:
    if arg.startswith("-"):
        return ".." not in arg and not _absolute(arg)
    return _relative_dir(arg) or _relative_file(arg)


def _safe_python(argv: list[str]) -> bool:
    if not argv or argv[0] == "-c":
        return False
    if argv[0] == "-m":
        return len(argv) >= 2 and argv[1] in {"pytest", "unittest"} and all(
            _safe_arg(arg) for arg in argv[2:]
        )
    return all(arg.endswith(".py") and _relative_file(arg) for arg in argv)


def _relative_dir(arg: str) -> bool:
    if _absolute(arg) or ".." in arg.replace("\\", "/").split("/"):
        return False
    return bool(arg) and not arg.startswith("-")


def _relative_file(arg: str) -> bool:
    return _relative_dir(arg)


def _absolute(arg: str) -> bool:
    text = arg.replace("\\", "/")
    if text.startswith("/"):
        return True
    return len(text) >= 2 and text[1] == ":"
