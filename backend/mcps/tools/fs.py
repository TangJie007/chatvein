"""文件系统工具（沙箱内）— 对齐 WorkBuddy Read/Write/Glob/Grep。"""

from __future__ import annotations

import re
from pathlib import Path

from langchain_core.tools import BaseTool, tool

from mcps.workspace import (  # pyright: ignore[reportImplicitRelativeImport]
    resolve_in_workspace,
    workspace_root,
)

_MAX_READ = 120_000
_MAX_GREP_HITS = 40
_MAX_LIST = 200


@tool
def fs_workspace_root() -> str:
    """返回 Agent 文件沙箱根目录的绝对路径。"""
    return str(workspace_root())


@tool
def fs_list_dir(path: str = ".") -> str:
    """列出工作区内某目录的直接子项（相对路径，默认根）。"""
    try:
        target = resolve_in_workspace(path)
    except ValueError as exc:
        return str(exc)
    if not target.exists():
        return f"不存在: {path}"
    if not target.is_dir():
        return f"不是目录: {path}"
    root = workspace_root()
    entries: list[str] = []
    for child in sorted(target.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower())):
        rel = child.relative_to(root).as_posix()
        kind = "dir" if child.is_dir() else "file"
        size = child.stat().st_size if child.is_file() else 0
        entries.append(f"{kind}\t{rel}\t{size}")
        if len(entries) >= _MAX_LIST:
            entries.append("…(已截断)")
            break
    return "\n".join(entries) if entries else "(空目录)"


@tool
def fs_read_file(path: str, offset: int = 0, limit: int = 400) -> str:
    """读取工作区内文本文件。offset/limit 为行号（从 0 起）；大文件自动截断。"""
    try:
        target = resolve_in_workspace(path)
    except ValueError as exc:
        return str(exc)
    if not target.is_file():
        return f"不是文件或不存在: {path}"
    try:
        text = target.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        return f"读取失败: {exc}"
    lines = text.splitlines()
    start = max(0, int(offset))
    end = start + max(1, int(limit))
    chunk = "\n".join(lines[start:end])
    if len(chunk) > _MAX_READ:
        chunk = chunk[:_MAX_READ] + "\n…(字节截断)"
    header = f"# {path} lines {start}-{min(end, len(lines))}/{len(lines)}\n"
    return header + chunk


@tool
def fs_write_file(path: str, content: str, append: bool = False) -> str:
    """在工作区内写入文本文件；父目录不存在时自动创建。append=true 追加。"""
    try:
        target = resolve_in_workspace(path)
    except ValueError as exc:
        return str(exc)
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        mode = "a" if append else "w"
        with target.open(mode, encoding="utf-8") as fh:
            fh.write(content)
    except OSError as exc:
        return f"写入失败: {exc}"
    return f"ok path={path} bytes={len(content.encode('utf-8'))} append={append}"


@tool
def fs_glob(pattern: str = "**/*") -> str:
    """在工作区内按 glob 查找文件（如 ``**/*.md``）。"""
    root = workspace_root()
    pat = (pattern or "**/*").strip() or "**/*"
    hits: list[str] = []
    try:
        for p in sorted(root.glob(pat)):
            if p.is_file():
                hits.append(p.relative_to(root).as_posix())
            if len(hits) >= _MAX_LIST:
                hits.append("…(已截断)")
                break
    except ValueError as exc:
        return f"glob 失败: {exc}"
    return "\n".join(hits) if hits else "(无匹配)"


@tool
def fs_grep(pattern: str, path: str = ".", glob: str = "**/*") -> str:
    """在工作区文本文件中按正则搜索内容，返回 path:line:snippet。"""
    try:
        base = resolve_in_workspace(path)
    except ValueError as exc:
        return str(exc)
    try:
        rx = re.compile(pattern)
    except re.error as exc:
        return f"正则无效: {exc}"

    files: list[Path] = []
    if base.is_file():
        files = [base]
    elif base.is_dir():
        files = [p for p in base.glob(glob or "**/*") if p.is_file()]
    else:
        return f"路径不存在: {path}"

    root = workspace_root()
    hits: list[str] = []
    for fp in files[:500]:
        try:
            text = fp.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for i, line in enumerate(text.splitlines(), start=1):
            if rx.search(line):
                rel = fp.relative_to(root).as_posix()
                snippet = line.strip()[:200]
                hits.append(f"{rel}:{i}:{snippet}")
                if len(hits) >= _MAX_GREP_HITS:
                    hits.append("…(已截断)")
                    return "\n".join(hits)
    return "\n".join(hits) if hits else "(无匹配)"


TOOLS: tuple[BaseTool, ...] = (
    fs_workspace_root,
    fs_list_dir,
    fs_read_file,
    fs_write_file,
    fs_glob,
    fs_grep,
)


def heuristic(text: str) -> list[str]:
    names: list[str] = []
    if any(k in text for k in ("工作区", "workspace", "沙箱根")):
        names.append("fs_workspace_root")
    if any(k in text for k in ("列出文件", "列目录", "ls ", "list dir", "有哪些文件")):
        names.append("fs_list_dir")
    if any(k in text for k in ("读文件", "打开文件", "查看文件", "read file", "读取")):
        names.append("fs_read_file")
    if any(k in text for k in ("写文件", "保存到", "创建文件", "write file", "写入")):
        names.append("fs_write_file")
    if any(k in text for k in ("glob", "找文件", "匹配文件", "*.md", "*.txt")):
        names.append("fs_glob")
    if any(k in text for k in ("grep", "搜索内容", "在文件里找", "全文检索")):
        names.append("fs_grep")
    return names
