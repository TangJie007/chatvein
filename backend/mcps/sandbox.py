"""会话工作区：时间戳-随机5字符目录，内含 output / logs / runs。

- ``output/``：Agent 产物（用户需要的文件）
- ``logs/session.sqlite``：本会话管理、工具返回、短期记忆
- ``runs/``：代码沙箱虚拟环境与执行脚本（与产物隔离）
"""

from __future__ import annotations

import os
import re
import secrets
import shutil
import string
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime
from pathlib import Path

from mcps.workspace import workspace_root  # pyright: ignore[reportImplicitRelativeImport]

_NAME = re.compile(r"^\d{8}-\d{6}-[a-z0-9]{5}$")
_ALPHABET = string.ascii_lowercase + string.digits
_current: ContextVar[Path | None] = ContextVar("chatvein_codesandbox", default=None)

OUTPUT_DIR = "output"
LOGS_DIR = "logs"
RUNS_DIR = "runs"
SESSION_DB_NAME = "session.sqlite"
LAYOUT_DIRS = (OUTPUT_DIR, LOGS_DIR, RUNS_DIR)


def allocate_workspace_name(now: datetime | None = None) -> str:
    """``YYYYMMDD-HHMMSS`` + ``-`` + 5 位小写字母或数字。"""
    stamp = (now or datetime.now()).strftime("%Y%m%d-%H%M%S")
    suffix = "".join(secrets.choice(_ALPHABET) for _ in range(5))
    return f"{stamp}-{suffix}"


def conversation_root(name: str) -> Path:
    """把已分配的目录名解析到当前主空间内。名称不合法或越界则抛 ``ValueError``。"""
    text = (name or "").strip()
    if not _NAME.fullmatch(text):
        raise ValueError("会话工作区名称无效")
    root = workspace_root()
    target = (root / text).resolve()
    try:
        target.relative_to(root)
    except ValueError as exc:
        raise ValueError(f"会话工作区越界: {text}") from exc
    return target


def init_conversation_layout(root: Path) -> Path:
    """确保 ``output/`` ``logs/`` ``runs/`` 与 ``logs/session.sqlite`` 存在。"""
    root.mkdir(parents=True, exist_ok=True)
    for name in LAYOUT_DIRS:
        (root / name).mkdir(parents=True, exist_ok=True)
    # 延迟导入，避免与 conversations 包循环依赖
    from conversations.session_store import ensure_session_db  # pyright: ignore[reportImplicitRelativeImport]

    ensure_session_db(session_db_path(root))
    return root


def output_dir(root: Path | None = None) -> Path:
    base = root if root is not None else current_sandbox()
    path = base / OUTPUT_DIR
    path.mkdir(parents=True, exist_ok=True)
    return path


def logs_dir(root: Path | None = None) -> Path:
    base = root if root is not None else current_sandbox()
    path = base / LOGS_DIR
    path.mkdir(parents=True, exist_ok=True)
    return path


def runs_dir(root: Path | None = None) -> Path:
    base = root if root is not None else current_sandbox()
    path = base / RUNS_DIR
    path.mkdir(parents=True, exist_ok=True)
    return path


def session_db_path(root: Path | None = None) -> Path:
    return logs_dir(root) / SESSION_DB_NAME


def create_conversation_dir() -> str:
    """在主空间新建会话目录并初始化布局，返回目录名。"""
    root = workspace_root()
    root.mkdir(parents=True, exist_ok=True)
    for _ in range(8):
        name = allocate_workspace_name()
        path = root / name
        try:
            path.mkdir(parents=False, exist_ok=False)
        except FileExistsError:
            continue
        init_conversation_layout(path)
        return name
    raise RuntimeError("无法分配会话工作区")


def remove_conversation_dir(name: str) -> None:
    """删除会话目录。名称非法或已不在主空间内时什么都不做。"""
    if not (name or "").strip():
        return
    try:
        path = conversation_root(name)
    except ValueError:
        return
    if not path.is_dir():
        return
    # Windows 上 session.sqlite 的 WAL 句柄可能尚未释放，重试几次。
    import time

    for attempt in range(5):
        shutil.rmtree(path, ignore_errors=True)
        if not path.exists():
            return
        time.sleep(0.05 * (attempt + 1))
    shutil.rmtree(path, ignore_errors=True)


def venv_python(root: Path | None = None) -> Path:
    """会话沙箱解释器：始终在 ``runs/.venv`` 下。"""
    runs = runs_dir(root)
    if os.name == "nt":
        return runs / ".venv" / "Scripts" / "python.exe"
    return runs / ".venv" / "bin" / "python"


@contextmanager
def use_conversation_sandbox(name: str) -> Iterator[Path]:
    """把后续代码沙箱工具绑定到这个会话目录（含布局补齐）。"""
    root = init_conversation_layout(conversation_root(name))
    token = _current.set(root)
    try:
        yield root
    finally:
        _current.reset(token)


def current_sandbox() -> Path:
    root = _current.get()
    if root is None:
        raise ValueError("当前没有会话工作区，无法使用代码沙箱")
    return root


def resolve_in_sandbox(path: str) -> Path:
    """解析到当前会话目录内。

    接受相对路径，或仍落在会话根下的绝对路径（便于沿用 ``list_directory`` /
    ``search_files`` 返回的完整路径）。越界则抛 ``ValueError``。
    """
    root = current_sandbox().resolve()
    text = (path or "").strip()
    if not text or text in {".", "./", ".\\"}:
        raise ValueError("请给出会话工作区内的路径")
    candidate = Path(text)
    if candidate.is_absolute():
        target = candidate.resolve()
    else:
        target = (root / candidate).resolve()
    try:
        target.relative_to(root)
    except ValueError as exc:
        raise ValueError(f"路径越界会话工作区: {path}") from exc
    return target


def resolve_in_runs(path: str) -> Path:
    """解析到当前会话 ``runs/`` 内。

    接受相对路径（``foo.py`` 或 ``runs/foo.py``），或仍落在 ``runs/`` 下的绝对路径。
    """
    runs = runs_dir().resolve()
    text = (path or "").strip()
    if not text or text in {".", "./", ".\\"}:
        raise ValueError("请给出 runs/ 内的路径")
    candidate = Path(text)
    if candidate.is_absolute():
        target = candidate.resolve()
    else:
        # 允许调用方写 ``runs/foo.py`` 或 ``foo.py``
        parts = candidate.parts
        if parts and parts[0] == RUNS_DIR:
            candidate = Path(*parts[1:]) if len(parts) > 1 else Path(".")
            if str(candidate) == ".":
                raise ValueError("请给出 runs/ 内的路径")
        target = (runs / candidate).resolve()
    try:
        target.relative_to(runs)
    except ValueError as exc:
        raise ValueError(f"路径越界 runs/: {path}") from exc
    return target
