"""Agent 工作区：所有文件类工具的沙箱根目录。"""

from __future__ import annotations

import os
from pathlib import Path

_ENV = "CHATVEIN_WORKSPACE"


def workspace_root() -> Path:
    """``CHATVEIN_WORKSPACE`` > ``~/ChatVeinWorkspace``，不存在则创建。"""
    raw = (os.environ.get(_ENV) or "").strip()
    root = Path(raw).expanduser() if raw else Path.home() / "ChatVeinWorkspace"
    root.mkdir(parents=True, exist_ok=True)
    return root.resolve()


def resolve_in_workspace(rel_path: str) -> Path:
    """把相对路径解析到工作区内；越界则抛 ``ValueError``。"""
    root = workspace_root()
    text = (rel_path or ".").strip() or "."
    # 禁止绝对路径直接逃出（Windows 盘符 / Unix 根）
    candidate = Path(text)
    if candidate.is_absolute():
        target = candidate.resolve()
    else:
        target = (root / candidate).resolve()
    try:
        target.relative_to(root)
    except ValueError as exc:
        raise ValueError(f"路径越界工作区: {rel_path}") from exc
    return target
