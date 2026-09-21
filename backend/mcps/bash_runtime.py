"""Git Bash 路径：显式配置优先，其次随应用附带的 Portable Git，最后本机安装。

显式路径不存在时直接失败，不回落到别的解释器。
"""

from __future__ import annotations

import os
from pathlib import Path


def resolve_bash() -> Path | None:
    """返回 ``bash`` 可执行文件。``CHATVEIN_GIT_BASH`` 无效时抛 ``ValueError``。"""
    explicit = (os.environ.get("CHATVEIN_GIT_BASH") or "").strip()
    if explicit:
        path = Path(explicit).expanduser()
        if not path.is_file():
            raise ValueError(f"CHATVEIN_GIT_BASH 不存在: {explicit}")
        return path.resolve()

    for candidate in _candidates():
        if candidate.is_file():
            return candidate.resolve()
    return None


def _candidates() -> list[Path]:
    found: list[Path] = []
    resource = (os.environ.get("CHATVEIN_RESOURCE_DIR") or "").strip()
    if resource:
        root = Path(resource).expanduser()
        found.append(root / "git" / "bin" / _bash_name())
    repo_resources = Path(__file__).resolve().parents[2] / "resources" / "git" / "bin" / _bash_name()
    found.append(repo_resources)
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
    return found


def _bash_name() -> str:
    return "bash.exe" if os.name == "nt" else "bash"
