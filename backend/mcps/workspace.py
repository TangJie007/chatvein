"""Agent 工作区：所有文件类工具的沙箱根目录。

用户在应用设置里选定的「主空间」优先于环境变量；未设置时回落到
``CHATVEIN_WORKSPACE`` 或 ``~/ChatVeinWorkspace``。
"""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path

_ENV = "CHATVEIN_WORKSPACE"
_LABEL = "主空间"
_lock = threading.Lock()


class _Cache:
    loaded: bool = False
    user_root: Path | None = None


_cache = _Cache()


def _config_file() -> Path:
    data_dir = (os.environ.get("CHATVEIN_DATA_DIR") or "").strip()
    base = (
        Path(data_dir).expanduser()
        if data_dir
        else Path(__file__).resolve().parents[1] / "data"
    )
    return base / "workspace.json"


def _read_saved() -> Path | None:
    path = _config_file()
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        raw = str(data.get("path") or "").strip()
    except (OSError, json.JSONDecodeError, AttributeError, TypeError):
        return None
    if not raw:
        return None
    candidate = Path(raw).expanduser()
    if not candidate.is_dir():
        return None
    return candidate.resolve()


def _default_root() -> Path:
    raw = (os.environ.get(_ENV) or "").strip()
    root = Path(raw).expanduser() if raw else Path.home() / "ChatVeinWorkspace"
    root.mkdir(parents=True, exist_ok=True)
    return root.resolve()


def _ensure_loaded() -> Path | None:
    if not _cache.loaded:
        _cache.user_root = _read_saved()
        _cache.loaded = True
    return _cache.user_root


def workspace_root() -> Path:
    """用户主空间 > ``CHATVEIN_WORKSPACE`` > ``~/ChatVeinWorkspace``。"""
    with _lock:
        user = _ensure_loaded()
    if user is not None:
        return user
    return _default_root()


def workspace_view() -> dict[str, object]:
    """设置页读取：当前生效路径，以及是否为用户自选。"""
    with _lock:
        user = _ensure_loaded()
    custom = user is not None
    root = user if user is not None else _default_root()
    return {"path": str(root), "label": _LABEL, "custom": custom}


def set_workspace(raw: str) -> dict[str, object]:
    """把主空间切到已存在的文件夹，并写入本机配置。"""
    text = (raw or "").strip().strip('"')
    if not text:
        raise ValueError("请选择一个文件夹")
    candidate = Path(text).expanduser()
    try:
        resolved = candidate.resolve(strict=True)
    except OSError as exc:
        raise ValueError("找不到该文件夹") from exc
    if not resolved.is_dir():
        raise ValueError("请选择文件夹，而不是文件")

    cfg = _config_file()
    cfg.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps({"path": str(resolved)}, ensure_ascii=False) + "\n"
    tmp = cfg.with_suffix(".json.tmp")
    tmp.write_text(payload, encoding="utf-8")
    tmp.replace(cfg)

    with _lock:
        _cache.user_root = resolved
        _cache.loaded = True
    return {"path": str(resolved), "label": _LABEL, "custom": True}


def reset_workspace() -> dict[str, object]:
    """丢掉用户选择，回到默认主空间。"""
    try:
        _config_file().unlink(missing_ok=True)
    except OSError as exc:
        raise ValueError("无法恢复默认工作区") from exc

    with _lock:
        _cache.user_root = None
        _cache.loaded = True
    return {"path": str(_default_root()), "label": _LABEL, "custom": False}


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
