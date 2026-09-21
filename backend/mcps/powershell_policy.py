"""PowerShell 命令分级（仅 Windows，对齐 WorkBuddy 的危险模式拦截）。"""

from __future__ import annotations

import re
from typing import Literal

DecisionKind = Literal["allow", "ask", "deny"]

_DENY: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"[\n\r]"), "不允许换行拼接命令"),
    (re.compile(r"\bInvoke-Expression\b", re.I), "不允许 Invoke-Expression"),
    (re.compile(r"\biex\b", re.I), "不允许 iex"),
    (re.compile(r"\bAdd-Type\b", re.I), "不允许 Add-Type"),
    (re.compile(r"\bStart-Process\b", re.I), "不允许 Start-Process"),
    (re.compile(r"DownloadString|DownloadFile|Invoke-WebRequest|iwr\b|curl\b|wget\b", re.I), "不允许下载执行"),
    (re.compile(r"\bRemove-Item\b|\brm\b|\bdel\b|\brmdir\b", re.I), "不允许删除命令"),
    (re.compile(r"\bFormat-Volume\b|\bdiskpart\b|\bStop-Computer\b|\bRestart-Computer\b", re.I), "不允许磁盘或关机命令"),
    (re.compile(r"\bcmd\.exe\b|\bbash\b", re.I), "不允许再套一层 shell"),
    (re.compile(r"\.\."), "不允许 .. 跳出目录"),
    (re.compile(r"[A-Za-z]:[/\\]"), "不允许访问盘符路径"),
)

_META = set("|;&><`")


def classify_powershell(command: str) -> tuple[DecisionKind, str]:
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
    head = text.split(None, 1)[0].lower()
    if head in {"pwd", "get-location", "ls", "dir", "get-childitem", "echo", "write-output", "git"}:
        if head == "git":
            rest = text.split(None, 1)[1] if " " in text else ""
            first = (rest.split() or [""])[0]
            if first not in {"status", "diff", "log", "rev-parse", "branch", "show"}:
                return "ask", "会改动会话目录，需要确认"
        return "allow", "只读或限定在会话目录内"
    if head in {"cd", "set-location"}:
        return "allow", "只读或限定在会话目录内"
    return "ask", "会改动会话目录，需要确认"
