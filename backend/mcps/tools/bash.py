"""Git Bash：每条命令一个进程，工作目录留在当前会话目录里。

只读命令直接执行。会改文件的命令等界面确认。``rm``、下载再执行、跳出目录的命令直接拒绝。
环境变量不跨命令保留；当前目录在同一会话内保留。
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

from langchain_core.tools import BaseTool, tool

from mcps.bash_approval import create_pending, wait_decision  # pyright: ignore[reportImplicitRelativeImport]
from mcps.bash_policy import classify  # pyright: ignore[reportImplicitRelativeImport]
from mcps.bash_runtime import resolve_bash  # pyright: ignore[reportImplicitRelativeImport]
from mcps.sandbox import current_sandbox, venv_python  # pyright: ignore[reportImplicitRelativeImport]

_MAX_OUTPUT = 12_000
_cwd: dict[str, Path] = {}
_WRAPPER = """
cd -- "$1" || exit 97
eval "$2"
status=$?
pwd -P > "$3"
exit $status
"""


def _to_msys(path: Path) -> str:
    resolved = path.resolve()
    if os.name != "nt":
        return resolved.as_posix()
    drive = resolved.drive.rstrip(":").lower()
    if not drive:
        return resolved.as_posix()
    rest = resolved.as_posix().split(":", 1)[-1]
    return f"/{drive}{rest}"


def _from_msys(text: str) -> Path:
    raw = text.strip().replace("\\", "/")
    if os.name == "nt" and len(raw) >= 4 and raw[0] == "/" and raw[2] == "/" and raw[1].isalpha():
        return Path(f"{raw[1].upper()}:{raw[2:]}")
    return Path(raw)


def _clip(text: str | bytes | None) -> str:
    if text is None:
        return ""
    value = text.decode("utf-8", errors="replace") if isinstance(text, bytes) else text
    if len(value) <= _MAX_OUTPUT:
        return value
    return value[:_MAX_OUTPUT] + "\n…(输出已截断)"


def _lookup_bash() -> tuple[Path, None] | tuple[None, str]:
    try:
        bash = resolve_bash()
    except ValueError as exc:
        return None, str(exc)
    if bash is None:
        return None, "未找到 Git Bash。可安装 Git for Windows，或等待应用下载 MinGit；也可设置 CHATVEIN_GIT_BASH。Windows 上可改用 powershell_run。"
    return bash, None


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


def _child_env(root: Path, bash: Path) -> dict[str, str]:
    env = os.environ.copy()
    git_root = bash.parent.parent
    prefix = [
        git_root / "cmd",
        git_root / "usr" / "bin",
        git_root / "bin",
        bash.parent,
    ]
    extra = os.pathsep.join(str(path) for path in prefix if path.is_dir())
    python = venv_python(root)
    if python.is_file():
        extra = str(python.parent) + (os.pathsep + extra if extra else "")
        env["VIRTUAL_ENV"] = str((root / ".venv").resolve())
        env["PYTHONNOUSERSITE"] = "1"
    if extra:
        env["PATH"] = extra + os.pathsep + env.get("PATH", "")
    env["MSYS_NO_PATHCONV"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    return env


def _execute(command: str, *, timeout: int) -> str:
    root = current_sandbox()
    bash, err = _lookup_bash()
    if err or bash is None:
        return err or "未找到 Git Bash"
    cwd = _working_dir(root)
    marker_dir = root / ".chatvein"
    marker_dir.mkdir(parents=True, exist_ok=True)
    marker = marker_dir / "cwd"
    try:
        completed = subprocess.run(
            [
                str(bash),
                "--noprofile",
                "--norc",
                "-c",
                _WRAPPER,
                "bash",
                _to_msys(cwd),
                command,
                _to_msys(marker),
            ],
            cwd=cwd,
            env=_child_env(root, bash),
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
            reported_path = _from_msys(reported).resolve()
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
def bash_info() -> str:
    """查看 Git Bash 是否可用，以及当前会话目录里的工作目录。"""
    try:
        root = current_sandbox()
    except ValueError as exc:
        return str(exc)
    bash, err = _lookup_bash()
    cwd = _working_dir(root)
    try:
        shown = cwd.resolve().relative_to(root.resolve()).as_posix() or "."
    except ValueError:
        shown = "."
    if err or bash is None:
        return f"{err}\ncwd={shown}"
    return f"bash={bash}\ncwd={shown}"


@tool
def bash_run(command: str, timeout_seconds: int = 30) -> str:
    """在当前会话目录用 Git Bash 执行一条命令。只读命令会直接跑；会改文件的命令要等用户在界面上允许；rm、下载执行和跳出目录会被拒绝。"""
    kind, reason = classify(command)
    if kind == "deny":
        return f"拒绝执行: {reason}"
    try:
        root = current_sandbox()
    except ValueError as exc:
        return str(exc)
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


TOOLS: tuple[BaseTool, ...] = (bash_info, bash_run)


def heuristic(text: str) -> list[str]:
    if any(k in text for k in ("git bash", "bash", "终端", "shell", "git status", "git diff", "命令行")):
        return ["bash_run"]
    return []
