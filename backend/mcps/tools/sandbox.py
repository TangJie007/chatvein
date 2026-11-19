"""代码沙箱：绑定当前会话工作区（与文件系统工具同一根）。

- 脚本 / ``.venv`` / pip：只在会话 ``runs/`` 内
- ``sandbox_run_python`` 的进程 cwd：会话根（可相对路径写 ``output/``）
- 用户产物优先用文件系统工具写 ``output/``，避免与执行环境混在一起
"""

from __future__ import annotations

import os
import re
import sys
import time
from pathlib import Path

from langchain_core.tools import BaseTool, tool

from mcps.audit import record_event  # pyright: ignore[reportImplicitRelativeImport]
from mcps.sandbox import (  # pyright: ignore[reportImplicitRelativeImport]
    current_sandbox,
    resolve_in_runs,
    runs_dir,
    venv_python,
)
from mcps.sandbox_guard import (  # pyright: ignore[reportImplicitRelativeImport]
    apply_network_env,
    dropped_env_keys,
    ensure_network_guard,
    guard_note,
    network_enabled,
    pip_base_args,
    run_limited,
    sanitize_env,
    with_guard_pythonpath,
)

from ._output import clip

_MAX_CODE = 100_000
_PKG = re.compile(
    r"^[A-Za-z0-9][A-Za-z0-9._\-]*"
    r"(?:\[[A-Za-z0-9,_\-]+\])?"
    r"(?:==|>=|<=|~=|!=|>|<|=)?"
    r"[A-Za-z0-9.*!+_]*$"
)


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


def _run(
    cmd: list[str],
    *,
    cwd: Path,
    timeout: int,
    env: dict[str, str] | None = None,
    tool_name: str = "sandbox",
    audit_args: dict[str, object] | None = None,
) -> str:
    """统一执行入口：资源限额 + 审计 + 与旧版一致的三段式输出。"""
    started = time.perf_counter()
    payload = dict(audit_args or {})
    payload.setdefault("cmd", cmd[0] if cmd else "")
    payload.setdefault("timeout", timeout)
    try:
        result = run_limited(cmd, cwd=cwd, env=env, timeout=timeout)
    except OSError as exc:
        record_event(
            "sandbox.exec",
            tool=tool_name,
            scope=str(cwd),
            args=payload,
            result_code="SPAWN_FAILED",
            duration_ms=int((time.perf_counter() - started) * 1000),
        )
        return f"执行失败: {exc}"
    duration = int((time.perf_counter() - started) * 1000)
    if result.timed_out:
        code = "TIMEOUT"
    elif result.returncode < 0:
        code = "SIGNAL"
    elif result.returncode != 0:
        code = "FAILED"
    else:
        code = "OK"
    record_event(
        "sandbox.exec",
        tool=tool_name,
        scope=str(cwd),
        args=payload,
        result_code=code,
        duration_ms=duration,
    )
    body = (
        f"stdout:\n{clip(result.stdout)}\n"
        f"stderr:\n{clip(result.stderr)}"
    )
    if result.timed_out:
        return f"超时（{timeout}s）已终止\n{body}"
    if result.returncode < 0:
        return f"exit={result.returncode}（进程被信号终止，可能触发{guard_note()}）\n{body}"
    return f"exit={result.returncode}\n{body}"


@tool
def sandbox_info() -> str:
    """开始沙箱任务前先探查环境：返回当前会话工作区根、``runs/``/``output/`` 路径，以及 Python 虚拟环境是否已就绪。

    示例：不确定沙箱是否可用时先 ``sandbox_info()`` 确认再决定后续步骤。
    """
    try:
        root = current_sandbox()
        runs = runs_dir()
    except ValueError as exc:
        return str(exc)
    python = venv_python()
    ready = python.is_file()
    dropped = dropped_env_keys()
    return (
        f"workspace={root}\n"
        f"runs={runs}\n"
        f"output={root / 'output'}\n"
        f"logs={root / 'logs'}\n"
        f"venv={'ready' if ready else 'missing'}\n"
        f"python={python}\n"
        f"guard={guard_note()}\n"
        f"env=cleaned（子进程已移除 {len(dropped)} 个敏感变量）"
    )


@tool
def sandbox_create_venv() -> str:
    """在当前会话 ``runs/`` 下创建 Python 虚拟环境（``.venv``），已存在则直接返回。要运行任何 Python 代码必须先调用它。

    示例：首次跑 Python 前 ``sandbox_create_venv()``，成功后即可写脚本、装包、运行。
    """
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
    """把 Python 脚本等文本写入当前会话 ``runs/``（执行区，与产物隔离）。``path`` 可为相对路径（如 ``main.py``、``scripts/analyze.py``）或 ``runs/`` 内绝对路径；不能写进 ``.venv``。给用户的交付文件请用文件系统工具写到 ``output/``。

    示例：``sandbox_write_file(path="main.py", content="print('hi')\\n")``；或把 ``sandbox_run_python`` 要用的脚本先写到 ``path="analyze.py"``。
    """
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
    """用 ``runs/.venv`` 给代码沙箱安装 PyPI 包。当脚本运行时 import 报错缺包时先调它。``packages`` 为空格或逗号分隔的包名，可带版本；一次最多 8 个。

    示例：``sandbox_pip_install(packages="requests pandas")``；指定版本 ``sandbox_pip_install(packages="numpy==1.26.0")``。
    """
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
    try:
        base = pip_base_args()
    except ValueError as exc:
        return str(exc)
    # pip 必须联网（源站是唯一出口），因此这里不注入黑洞代理；源地址由 pip_base_args 固定。
    return _run(
        [str(python), "-m", "pip", "install", *base, *parts],
        cwd=runs,
        timeout=180,
        tool_name="sandbox_pip_install",
        audit_args={"packages": parts, "index": "custom" if len(base) > 2 else "default"},
    )


@tool
def sandbox_run_python(path: str = "", code: str = "", timeout_seconds: int = 30) -> str:
    """用 ``runs/.venv`` 执行 Python 脚本（虚拟环境未建时先 ``sandbox_create_venv()``）。``code`` 非空则先写入 ``path``（默认 ``main.py``，落在 ``runs/``）再运行；否则直接运行 ``runs/`` 下已有的 ``path``。``timeout_seconds`` 上限 120，默认 30。

    工作目录是**当前会话工作区根**（与文件系统工具相同）：脚本里 ``output/xxx`` 等相对路径会写到会话产物目录（可交付给用户），脚本文件本身仍在 ``runs/``。

    示例：快速跑一段代码 ``sandbox_run_python(code="print(1+1)")``；产出结果文件 ``sandbox_run_python(path="analyze.py", code="open('output/result.json','w').write('{}')\\n")``。
    """
    try:
        root = current_sandbox()
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
    # 密钥不进子进程：先清洗再补沙箱自己需要的变量（详见 mcps/sandbox_guard.py）。
    env = sanitize_env()
    scripts = python.parent
    env["VIRTUAL_ENV"] = str((runs / ".venv").resolve())
    env["PATH"] = str(scripts) + os.pathsep + env.get("PATH", "")
    env["PYTHONNOUSERSITE"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    env = apply_network_env(env)
    # 层 1 网络隔离：钩子目录前置到 PYTHONPATH，sitecustomize 才会被导入
    # （软隔离，见 mcps/sandbox_guard.py 模块 docstring）
    _, guard_status = ensure_network_guard(python)
    env = with_guard_pythonpath(env, python)
    # 只记被移除的键名（绝不记值），供审计与 3.2 的权限面板回看。
    removed = dropped_env_keys()
    if removed:
        record_event(
            "sandbox.env",
            tool="sandbox_run_python",
            scope=str(root),
            args={"dropped": removed},
            result_code="CLEANED",
        )
    # cwd = 会话根：与 write_file / bash 同一工作区地址；脚本在 runs/，产物可写 output/
    result = _run(
        [str(python), str(target)],
        cwd=root,
        timeout=timeout,
        env=env,
        tool_name="sandbox_run_python",
        audit_args={
            "file": f"runs/{target.relative_to(runs).as_posix()}",
            "network": "on" if network_enabled() else "off",
        },
    )
    return (
        f"file=runs/{target.relative_to(runs).as_posix()}\n"
        f"cwd={root}\n"
        f"guard={guard_status}\n"
        f"{result}"
    )


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
