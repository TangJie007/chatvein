"""Shell 解释器探测：对齐 WorkBuddy / CodeBuddy。

- 不随包装 Git；``CHATVEIN_GIT_BASH`` 优先，否则探测本机安装与 PATH。
- Windows 且未找到本机 bash 时，按需下载 MinGit 到 ``CHATVEIN_DATA_DIR/git-bash/``；
  ``CHATVEIN_SKIP_BASH_DOWNLOAD=1`` 关闭下载。下载失败则不注册 ``mcp-bash``，降级依赖 PowerShell。
- 显式路径无效时默认报错；``CHATVEIN_SKIP_GIT_BASH_CHECK=1`` 时告警并回落自动探测。
- Windows 另探测 PowerShell（``pwsh`` 优先，其次 Windows PowerShell 5.1）。
- ``CHATVEIN_USE_POWERSHELL_TOOL=0`` 时不启用 PowerShell 工具。
"""

from __future__ import annotations

import os
import shutil
from functools import lru_cache
from pathlib import Path

from mcps.bash_download import (  # pyright: ignore[reportImplicitRelativeImport]
    find_installed_bash,
    try_ensure_mingit_bash,
)


def bash_available() -> bool:
    return bool(probe_bash()["available"])


def powershell_available() -> bool:
    return bool(probe_powershell()["available"])


def resolve_bash() -> Path | None:
    """返回 bash。显式路径无效且未跳过检查时抛 ``ValueError``。"""
    status = probe_bash()
    if status.get("error"):
        raise ValueError(str(status["error"]))
    path = status.get("path")
    return Path(path) if isinstance(path, str) and path else None


def resolve_powershell() -> Path | None:
    status = probe_powershell()
    path = status.get("path")
    return Path(path) if isinstance(path, str) and path else None


def probe_bash() -> dict[str, object]:
    """``{available, path, source?, error?, message?}``。供注册表与设置页。"""
    return dict(_probe_bash_cached(_env_fingerprint()))


def probe_powershell() -> dict[str, object]:
    return dict(_probe_powershell_cached(_env_fingerprint()))


def clear_runtime_cache() -> None:
    _probe_bash_cached.cache_clear()
    _probe_powershell_cached.cache_clear()


def _env_fingerprint() -> tuple[str, ...]:
    return (
        (os.environ.get("CHATVEIN_GIT_BASH") or "").strip(),
        (os.environ.get("CHATVEIN_SKIP_GIT_BASH_CHECK") or "").strip(),
        (os.environ.get("CHATVEIN_SKIP_BASH_DOWNLOAD") or "").strip(),
        (os.environ.get("CHATVEIN_FORCE_BASH_DOWNLOAD") or "").strip(),
        (os.environ.get("CHATVEIN_POWERSHELL_PATH") or "").strip(),
        (os.environ.get("CHATVEIN_USE_POWERSHELL_TOOL") or "").strip(),
        (os.environ.get("CHATVEIN_DATA_DIR") or "").strip(),
        (os.environ.get("PATH") or "").strip(),
    )


@lru_cache(maxsize=8)
def _probe_bash_cached(_fingerprint: tuple[str, ...]) -> dict[str, object]:
    explicit = (os.environ.get("CHATVEIN_GIT_BASH") or "").strip()
    if explicit:
        path = Path(explicit).expanduser()
        if path.is_file():
            return {"available": True, "path": str(path.resolve()), "source": "env"}
        if (os.environ.get("CHATVEIN_SKIP_GIT_BASH_CHECK") or "").strip() == "1":
            print(f"CHATVEIN_GIT_BASH 无效，已回落自动探测: {explicit}", flush=True)
        else:
            return {
                "available": False,
                "path": None,
                "error": f"CHATVEIN_GIT_BASH 不存在: {explicit}",
            }

    for candidate in _bash_candidates():
        if candidate.is_file():
            return {
                "available": True,
                "path": str(candidate.resolve()),
                "source": "system",
            }

    bundled = find_installed_bash()
    if bundled is not None:
        return {
            "available": True,
            "path": str(bundled),
            "source": "mingit",
        }

    if os.name == "nt":
        path, err = try_ensure_mingit_bash()
        if path is not None:
            return {
                "available": True,
                "path": str(path),
                "source": "mingit",
            }
        return {
            "available": False,
            "path": None,
            "message": (
                f"MinGit 下载失败，已降级到 PowerShell（若可用）: {err}"
                if err
                else "未找到 Git Bash，已降级到 PowerShell（若可用）"
            ),
        }

    return {"available": False, "path": None}


@lru_cache(maxsize=8)
def _probe_powershell_cached(_fingerprint: tuple[str, ...]) -> dict[str, object]:
    if os.name != "nt":
        return {"available": False, "path": None, "message": "仅 Windows"}
    if (os.environ.get("CHATVEIN_USE_POWERSHELL_TOOL") or "").strip() == "0":
        return {
            "available": False,
            "path": None,
            "message": "已用 CHATVEIN_USE_POWERSHELL_TOOL=0 关闭",
        }

    explicit = (os.environ.get("CHATVEIN_POWERSHELL_PATH") or "").strip()
    if explicit:
        path = Path(explicit).expanduser()
        if path.is_file():
            return {"available": True, "path": str(path.resolve())}
        return {
            "available": False,
            "path": None,
            "error": f"CHATVEIN_POWERSHELL_PATH 不存在: {explicit}",
        }

    for candidate in _powershell_candidates():
        if candidate.is_file():
            return {"available": True, "path": str(candidate.resolve())}
    return {"available": False, "path": None}


def _bash_candidates() -> list[Path]:
    found: list[Path] = []
    if os.name == "nt":
        program = Path(os.environ.get("ProgramFiles", r"C:\Program Files"))
        program_x86 = Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"))
        local = Path(os.environ.get("LOCALAPPDATA", ""))
        found.extend(
            [
                program / "Git" / "bin" / "bash.exe",
                program_x86 / "Git" / "bin" / "bash.exe",
                local / "Programs" / "Git" / "bin" / "bash.exe",
            ]
        )
    else:
        found.extend([Path("/bin/bash"), Path("/usr/bin/bash")])
    which = shutil.which("bash")
    if which:
        found.append(Path(which))
    return found


def _powershell_candidates() -> list[Path]:
    found: list[Path] = []
    for name in ("pwsh", "powershell"):
        which = shutil.which(name)
        if which:
            found.append(Path(which))
    program = Path(os.environ.get("ProgramFiles", r"C:\Program Files"))
    for major in ("7", "7-preview"):
        found.append(program / "PowerShell" / major / "pwsh.exe")
    system = Path(os.environ.get("SystemRoot", r"C:\Windows"))
    found.append(system / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe")
    return found
