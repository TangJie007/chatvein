"""PowerShell：仅 Windows。有 Git Bash 时与 Bash 并存；无 Bash 时作为唯一 shell。"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

from langchain_core.tools import BaseTool, tool

from mcps.bash_approval import create_pending, wait_decision  # pyright: ignore[reportImplicitRelativeImport]
from mcps.bash_runtime import resolve_powershell  # pyright: ignore[reportImplicitRelativeImport]
from mcps.powershell_policy import classify_powershell  # pyright: ignore[reportImplicitRelativeImport]
from mcps.sandbox import current_sandbox, venv_python  # pyright: ignore[reportImplicitRelativeImport]

_MAX_OUTPUT = 12_000
_cwd: dict[str, Path] = {}


def _clip(text: str | bytes | None) -> str:
    if text is None:
        return ""
    value = text.decode("utf-8", errors="replace") if isinstance(text, bytes) else text
    if len(value) <= _MAX_OUTPUT:
        return value
    return value[:_MAX_OUTPUT] + "\n…(输出已截断)"


def _working_dir(root: Path) -> Path:
    cwd = _cwd.get(str(root), root)
    if not cwd.is_dir() or not _inside(cwd, root):
        return root
    return cwd


def _inside(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
    except ValueError:
        return False
    return True


def _child_env(root: Path) -> dict[str, str]:
    env = os.environ.copy()
    python = venv_python(root)
    if python.is_file():
        env["PATH"] = str(python.parent) + os.pathsep + env.get("PATH", "")
        env["VIRTUAL_ENV"] = str((root / ".venv").resolve())
        env["PYTHONNOUSERSITE"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    return env


def _execute(command: str, *, timeout: int) -> str:
    root = current_sandbox()
    shell = resolve_powershell()
    if shell is None:
        return "未找到 PowerShell"
    cwd = _working_dir(root)
    marker_dir = root / ".chatvein"
    marker_dir.mkdir(parents=True, exist_ok=True)
    marker = marker_dir / "cwd_ps"
    script = marker_dir / "run.ps1"
    script.write_text(
        "param([Parameter(Mandatory=$true)][string]$WorkDir,"
        "[Parameter(Mandatory=$true)][string]$Marker)\n"
        "Set-Location -LiteralPath $WorkDir\n"
        f"{command}\n"
        "$code = 0\n"
        "if ($null -ne $LASTEXITCODE) { $code = [int]$LASTEXITCODE }\n"
        "(Get-Location).Path | Set-Content -LiteralPath $Marker -Encoding utf8\n"
        "exit $code\n",
        encoding="utf-8",
        newline="\n",
    )
    try:
        completed = subprocess.run(
            [
                str(shell),
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                str(script),
                str(cwd),
                str(marker),
            ],
            cwd=cwd,
            env=_child_env(root),
            capture_output=True,
            timeout=timeout,
            text=True,
            encoding="utf-8",
            errors="replace",
            shell=False,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        return f"超时（{timeout}s）已终止\nstdout:\n{_clip(exc.stdout)}\nstderr:\n{_clip(exc.stderr)}"
    except OSError as exc:
        return f"执行失败: {exc}"

    note = ""
    if marker.is_file():
        reported = marker.read_text(encoding="utf-8", errors="replace").strip()
        try:
            reported_path = Path(reported).resolve()
        except OSError:
            reported_path = root
        if reported and _inside(reported_path, root) and reported_path.is_dir():
            _cwd[str(root)] = reported_path
        else:
            _cwd[str(root)] = root
            note = "\ncwd 已重置到会话目录（命令试图离开工作区）"
    relative = _cwd.get(str(root), root)
    try:
        shown = relative.resolve().relative_to(root.resolve()).as_posix() or "."
    except ValueError:
        shown = "."
    return (
        f"cwd={shown}\n"
        f"exit={completed.returncode}\n"
        f"stdout:\n{_clip(completed.stdout)}\n"
        f"stderr:\n{_clip(completed.stderr)}{note}"
    )


@tool
def powershell_info() -> str:
    """查看 PowerShell 是否可用，以及当前会话目录里的工作目录。仅 Windows。"""
    try:
        root = current_sandbox()
    except ValueError as exc:
        return str(exc)
    shell = resolve_powershell()
    cwd = _working_dir(root)
    try:
        shown = cwd.resolve().relative_to(root.resolve()).as_posix() or "."
    except ValueError:
        shown = "."
    if shell is None:
        return f"未找到 PowerShell\ncwd={shown}"
    return f"powershell={shell}\ncwd={shown}"


@tool
def powershell_run(command: str, timeout_seconds: int = 30) -> str:
    """在当前会话目录用 PowerShell 执行一条命令。仅 Windows。只读直接跑；会改文件的需用户确认；危险命令拒绝。"""
    kind, reason = classify_powershell(command)
    if kind == "deny":
        return f"拒绝执行: {reason}"
    try:
        root = current_sandbox()
    except ValueError as exc:
        return str(exc)
    if resolve_powershell() is None:
        return "未找到 PowerShell"
    timeout = max(1, min(int(timeout_seconds), 120))
    if kind == "ask":
        cwd = _working_dir(root)
        try:
            shown = cwd.resolve().relative_to(root.resolve()).as_posix() or "."
        except ValueError:
            shown = "."
        approval_id = create_pending(command.strip(), shown)
        decision = wait_decision(approval_id, _approval_timeout())
        if decision != "allow":
            return "未执行：用户拒绝或确认超时。不要改写命令绕过确认。"
    return _execute(command.strip(), timeout=timeout)


def _approval_timeout() -> float:
    raw = (os.environ.get("CHATVEIN_BASH_APPROVAL_TIMEOUT") or "").strip()
    try:
        return max(1.0, float(raw)) if raw else 120.0
    except ValueError:
        return 120.0


TOOLS: tuple[BaseTool, ...] = (powershell_info, powershell_run)


def heuristic(text: str) -> list[str]:
    if any(k in text for k in ("powershell", "pwsh")):
        return ["powershell_run"]
    if any(k in text for k in ("终端", "shell", "命令行")) and not any(
        k in text for k in ("bash", "git bash")
    ):
        return ["powershell_run"]
    return []
