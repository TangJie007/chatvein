"""会话代码沙箱：主空间下的「时间戳-随机5字符」目录。

用户创建对话时分配该目录，之后写代码、建虚拟环境、执行 Python 都只落在这里。
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


def create_conversation_dir() -> str:
    """在主空间新建会话目录，返回目录名。"""
    root = workspace_root()
    root.mkdir(parents=True, exist_ok=True)
    for _ in range(8):
        name = allocate_workspace_name()
        path = root / name
        try:
            path.mkdir(parents=False, exist_ok=False)
        except FileExistsError:
            continue
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
    if path.is_dir():
        shutil.rmtree(path, ignore_errors=True)


def venv_python(root: Path) -> Path:
    if os.name == "nt":
        return root / ".venv" / "Scripts" / "python.exe"
    return root / ".venv" / "bin" / "python"


@contextmanager
def use_conversation_sandbox(name: str) -> Iterator[Path]:
    """把后续代码沙箱工具绑定到这个会话目录。"""
    root = conversation_root(name)
    root.mkdir(parents=True, exist_ok=True)
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


def resolve_in_sandbox(rel_path: str) -> Path:
    """把相对路径解析到当前会话目录内；越界则抛 ``ValueError``。"""
    root = current_sandbox()
    text = (rel_path or "").strip()
    if not text or text == ".":
        raise ValueError("请给出会话工作区内的相对路径")
    candidate = Path(text)
    if candidate.is_absolute():
        raise ValueError(f"请使用相对路径: {rel_path}")
    target = (root / candidate).resolve()
    try:
        target.relative_to(root)
    except ValueError as exc:
        raise ValueError(f"路径越界会话工作区: {rel_path}") from exc
    return target
