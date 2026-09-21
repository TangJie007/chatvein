"""代码沙箱：只在当前会话 ``runs/`` 里建虚拟环境、写 Python、执行。

产物请写到 ``output/``（用文件系统工具），避免与执行环境混在一起。
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

from langchain_core.tools import BaseTool, tool

from mcps.sandbox import (  # pyright: ignore[reportImplicitRelativeImport]
    current_sandbox,
    resolve_in_runs,
    runs_dir,
    venv_python,
)

_MAX_CODE = 100_000
_MAX_OUTPUT = 12_000
_PKG = re.compile(
    r"^[A-Za-z0-9][A-Za-z0-9._\-]*"
    r"(?:\[[A-Za-z0-9,_\-]+\])?"
    r"(?:==|>=|<=|~=|!=|>|<|=)?"
    r"[A-Za-z0-9.*!+_]*$"
)


def _clip(text: str | bytes | None) -> str:
    if text is None:
        return ""
    if isinstance(text, bytes):
        value = text.decode("utf-8", errors="replace")
    else:
        value = text
    if len(value) <= _MAX_OUTPUT:
        return value
    return value[:_MAX_OUTPUT] + "\n…(输出已截断)"


def _guard_write(path: Path) -> str | None:
    runs = runs_dir()
    try:
        relative = path.relative_to(runs)
    except ValueError:
        return "路径越界 runs/（代码沙箱只能写 runs/）"
    if not relative.parts or relative.parts[0] == ".venv":
        return "不能改虚拟环境目录里的文件"
    return None


def _interpreter() -> tuple[Path, None] | tuple[None, str]:
    runs = runs_dir()
    python = venv_python()
    if not python.is_file():
        return None, "虚拟环境还不存在，请先调用 sandbox_create_venv"
    resolved = python.resolve()
    try:
        resolved.relative_to(runs)
    except ValueError:
        return None, "虚拟环境解释器不在 runs/ 内"
    return resolved, None


def _run(cmd: list[str], *, cwd: Path, timeout: int, env: dict[str, str] | None = None) -> str:
    try:
        completed = subprocess.run(
            cmd,
            cwd=cwd,
            env=env,
            capture_output=True,
            timeout=timeout,
            text=True,
            encoding="utf-8",
            errors="replace",
            shell=False,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        return (
            f"超时（{timeout}s）已终止\n"
            f"stdout:\n{_clip(exc.stdout)}\n"
            f"stderr:\n{_clip(exc.stderr)}"
        )
    except OSError as exc:
        return f"执行失败: {exc}"
    return (
        f"exit={completed.returncode}\n"
        f"stdout:\n{_clip(completed.stdout)}\n"
        f"stderr:\n{_clip(completed.stderr)}"
    )


@tool
def sandbox_info() -> str:
    """查看当前会话工作区、``runs/`` 路径，以及 Python 虚拟环境是否已建好。"""
    try:
        root = current_sandbox()
        runs = runs_dir()
    except ValueError as exc:
        return str(exc)
    python = venv_python()
    ready = python.is_file()
    return (
        f"workspace={root}\n"
        f"runs={runs}\n"
        f"output={root / 'output'}\n"
        f"logs={root / 'logs'}\n"
        f"venv={'ready' if ready else 'missing'}\n"
        f"python={python}"
    )


@tool
def sandbox_create_venv() -> str:
    """在当前会话 ``runs/`` 下创建 Python 虚拟环境（``.venv``）。已存在则直接返回。"""
    try:
        runs = runs_dir()
    except ValueError as exc:
        return str(exc)
    python = venv_python()
    if python.is_file():
        return f"虚拟环境已存在: {python}"
    result = _run(
        [sys.executable, "-m", "venv", str(runs / ".venv")],
        cwd=runs,
        timeout=180,
    )
    if python.is_file():
        return f"已创建虚拟环境: {python}\n{result}"
    return f"创建虚拟环境失败\n{result}"


@tool
def sandbox_write_file(path: str, content: str) -> str:
    """把文本写入当前会话 ``runs/`` 的相对路径。用来编写 ``.py``。不能写进 ``.venv``，也不能逃出 ``runs/``。用户产物请写到 ``output/``。"""
    try:
        target = resolve_in_runs(path)
    except ValueError as exc:
        return str(exc)
    blocked = _guard_write(target)
    if blocked:
        return blocked
    if len(content) > _MAX_CODE:
        return f"内容过长（上限 {_MAX_CODE} 字符）"
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8", newline="\n")
    except OSError as exc:
        return f"写入失败: {exc}"
    return f"已写入 runs/{target.relative_to(runs_dir()).as_posix()} ({len(content)} 字符)"


@tool
def sandbox_pip_install(packages: str) -> str:
    """用 ``runs/.venv`` 安装 PyPI 包。``packages`` 为空格或逗号分隔的包名，可带版本如 ``requests==2.32.0``。一次最多 8 个。"""
    try:
        runs = runs_dir()
    except ValueError as exc:
        return str(exc)
    python, err = _interpreter()
    if err or python is None:
        return err or "虚拟环境还不存在"
    parts = [part.strip() for part in re.split(r"[\s,]+", packages or "") if part.strip()]
    if not parts:
        return "没有要安装的包"
    if len(parts) > 8:
        return "一次最多安装 8 个包"
    for part in parts:
        if part.startswith("-") or _PKG.fullmatch(part) is None:
            return f"包名不合法: {part}"
    return _run(
        [str(python), "-m", "pip", "install", *parts],
        cwd=runs,
        timeout=180,
    )


@tool
def sandbox_run_python(path: str = "", code: str = "", timeout_seconds: int = 30) -> str:
    """用 ``runs/.venv`` 执行 Python。``code`` 非空时先写入 ``path``（默认 ``main.py``，落在 ``runs/``）再运行；否则运行已有的 ``.py``。工作目录是 ``runs/``。"""
    try:
        runs = runs_dir()
    except ValueError as exc:
        return str(exc)
    python, err = _interpreter()
    if err or python is None:
        return err or "虚拟环境还不存在"
    timeout = max(1, min(int(timeout_seconds), 120))
    rel = (path or "").strip() or "main.py"
    if not rel.endswith(".py"):
        return "只能执行 .py 文件"
    if code:
        written = sandbox_write_file.invoke({"path": rel, "content": code})
        if not str(written).startswith("已写入"):
            return str(written)
    try:
        target = resolve_in_runs(rel)
    except ValueError as exc:
        return str(exc)
    blocked = _guard_write(target)
    if blocked:
        return blocked
    if not target.is_file():
        return f"文件不存在: runs/{rel}"
    env = os.environ.copy()
    scripts = python.parent
    env["VIRTUAL_ENV"] = str((runs / ".venv").resolve())
    env["PATH"] = str(scripts) + os.pathsep + env.get("PATH", "")
    env["PYTHONNOUSERSITE"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    result = _run([str(python), str(target)], cwd=runs, timeout=timeout, env=env)
    return f"file=runs/{target.relative_to(runs).as_posix()}\n{result}"


TOOLS: tuple[BaseTool, ...] = (
    sandbox_info,
    sandbox_create_venv,
    sandbox_write_file,
    sandbox_pip_install,
    sandbox_run_python,
)


def heuristic(text: str) -> list[str]:
    names: list[str] = []
    if any(
        k in text
        for k in (
            "python",
            "py代码",
            "虚拟环境",
            "venv",
            "跑代码",
            "运行代码",
            "执行代码",
            "写个脚本",
            "代码沙箱",
            "codesandbox",
            "sandbox",
        )
    ):
        names.extend(
            ["sandbox_create_venv", "sandbox_write_file", "sandbox_run_python"]
        )
    if "pip" in text or ("安装" in text and any(k in text for k in ("包", "库", "依赖"))):
        names.append("sandbox_pip_install")
    return names
