"""Git Bash：每条命令一个进程，工作目录留在当前会话目录里。

只读命令直接执行。会改文件的命令等界面确认。``rm``、下载再执行、跳出目录的命令直接拒绝。
环境变量不跨命令保留；当前目录在同一会话内保留。
"""

from __future__ import annotations

import os
import time
from pathlib import Path

from langchain_core.tools import BaseTool, tool

from mcps.approval import request_approval, unified_enabled  # pyright: ignore[reportImplicitRelativeImport]
from mcps.approval_policy import shell_approval  # pyright: ignore[reportImplicitRelativeImport]
from mcps.audit import record_event  # pyright: ignore[reportImplicitRelativeImport]
from mcps.bash_approval import create_pending, wait_decision  # pyright: ignore[reportImplicitRelativeImport]
from mcps.bash_policy import classify  # pyright: ignore[reportImplicitRelativeImport]
from mcps.bash_runtime import resolve_bash  # pyright: ignore[reportImplicitRelativeImport]
from mcps.sandbox import current_sandbox, venv_python  # pyright: ignore[reportImplicitRelativeImport]
from mcps.sandbox_guard import (  # pyright: ignore[reportImplicitRelativeImport]
    apply_network_env,
    ensure_network_guard,
    run_limited,
    sanitize_env,
    with_guard_pythonpath,
)

from ._output import clip

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
    # 密钥不进子进程（见 mcps/sandbox_guard.py）；随后再补 Git Bash 需要的变量。
    env = sanitize_env()
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
        env["VIRTUAL_ENV"] = str(python.parent.parent.resolve())
        env["PYTHONNOUSERSITE"] = "1"
        # shell 里起的 python 也走同一层网络软隔离（钩子目录前置到 PYTHONPATH）
        ensure_network_guard(python)
        env = with_guard_pythonpath(env, python)
    if extra:
        env["PATH"] = extra + os.pathsep + env.get("PATH", "")
    env["MSYS_NO_PATHCONV"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    return apply_network_env(env)


def _execute(command: str, *, timeout: int) -> str:
    root = current_sandbox()
    bash, err = _lookup_bash()
    if err or bash is None:
        return err or "未找到 Git Bash"
    cwd = _working_dir(root)
    marker_dir = root / ".chatvein"
    marker_dir.mkdir(parents=True, exist_ok=True)
    marker = marker_dir / "cwd"
    started = time.perf_counter()
    try:
        result = run_limited(
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
            timeout=timeout,
        )
    except OSError as exc:
        return f"执行失败: {exc}"
    record_event(
        "shell.exec",
        tool="bash_run",
        scope=str(root),
        args={"command": command},
        result_code=(
            "TIMEOUT" if result.timed_out else ("OK" if result.returncode == 0 else "FAILED")
        ),
        duration_ms=int((time.perf_counter() - started) * 1000),
    )
    if result.timed_out:
        return (
            f"超时（{timeout}s）已终止\n"
            f"stdout:\n{clip(result.stdout)}\n"
            f"stderr:\n{clip(result.stderr)}"
        )

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
        f"exit={result.returncode}\n"
        f"stdout:\n{clip(result.stdout)}\n"
        f"stderr:\n{clip(result.stderr)}{note}"
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
        if unified_enabled():
            decision = request_approval(
                shell_approval(command.strip(), shell="bash", cwd=shown)
            )
        else:
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
