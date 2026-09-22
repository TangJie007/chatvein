"""Agent 路径访问：会话内直通；会话外仅绝对路径且需人机确认。"""

from __future__ import annotations

import os
from pathlib import Path

from mcps.bash_approval import create_pending, wait_decision  # pyright: ignore[reportImplicitRelativeImport]
from mcps.sandbox import current_sandbox  # pyright: ignore[reportImplicitRelativeImport]


def _approval_timeout() -> float:
    raw = (os.environ.get("CHATVEIN_BASH_APPROVAL_TIMEOUT") or "").strip()
    if raw:
        try:
            return max(5.0, float(raw))
        except ValueError:
            pass
    return 120.0


def _inside(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
    except ValueError:
        return False
    return True


def resolve_agent_path(path: str, *, action: str) -> Path:
    """解析 Agent 文件工具路径。

    - 相对路径 / ``.``：只能落在当前会话工作区，无需确认
    - 绝对路径且在会话内：无需确认
    - 绝对路径且在会话外：弹窗确认；拒绝 / 超时则抛 ``ValueError``
    - 相对路径无法指向会话外（须改用绝对路径）
    """
    root = current_sandbox().resolve()
    text = (path or "").strip() or "."
    if text in {".", "./", ".\\"}:
        return root

    candidate = Path(text)
    if not candidate.is_absolute():
        target = (root / candidate).resolve()
        if not _inside(target, root):
            raise ValueError(
                "相对路径只能落在当前会话工作区内；"
                f"访问会话外请传入绝对路径（需确认）: {path}"
            )
        return target

    target = candidate.resolve()
    if _inside(target, root):
        return target

    approval_id = create_pending(
        f"{action}\n{target}",
        str(target.parent if str(target.parent) not in {"", "."} else target),
    )
    decision = wait_decision(approval_id, _approval_timeout())
    if decision != "allow":
        label = {"deny": "已拒绝", "timeout": "超时未确认"}.get(decision, decision)
        raise ValueError(f"会话外路径{label}: {target}")
    return target
