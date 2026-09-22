"""文件系统工具。

行为对齐 ``@modelcontextprotocol/server-filesystem``，不包含 ``read_media_file``。
另加 ``open_folder`` 与 ``delete_path``。

路径策略：
- 相对路径 / 会话内绝对路径 → 当前会话工作区，无需确认
- 会话外绝对路径 → 弹窗人机确认后才可访问
"""

from __future__ import annotations

import difflib
import json
import math
import os
import re
import secrets
import shutil
import stat
import subprocess
import sys
from datetime import datetime
from pathlib import Path, PurePosixPath
from typing import Annotated, Literal

from langchain_core.tools import BaseTool, tool
from pydantic import BaseModel, Field

from mcps.path_access import resolve_agent_path  # pyright: ignore[reportImplicitRelativeImport]
from mcps.sandbox import (  # pyright: ignore[reportImplicitRelativeImport]
    current_sandbox,
)

_MAX_READ_BYTES = 512_000
_MAX_EDIT_BYTES = 2_000_000
_MAX_WALK = 2_000


class FileEdit(BaseModel):
    oldText: str = Field(description="要被替换的原文（优先精确匹配）")
    newText: str = Field(description="替换后的新文本")


# 给 LLM 的 path 参数共用说明（写入 schema description）
_PATH = (
    "路径。会话内用相对 session_root 的路径（例：output/a.txt、.、runs/main.py）；"
    "会话外必须绝对路径并将请用户确认。不要用 ../ 逃出会话。"
)
_PATH_FILE = (
    "文件路径。会话内推荐相对路径（例：output/hello.txt）；"
    "会话外必须绝对路径并将请用户确认。"
)
_PATH_DIR = (
    "目录路径。会话内推荐相对路径（例：output、.）；"
    "会话外必须绝对路径并将请用户确认。`.` 表示会话根。"
)


def _format_size(nbytes: int) -> str:
    units = ["B", "KB", "MB", "GB", "TB"]
    if nbytes <= 0:
        return "0 B"
    index = int(math.floor(math.log(nbytes) / math.log(1024)))
    if index <= 0:
        return f"{nbytes} B"
    index = min(index, len(units) - 1)
    return f"{nbytes / (1024**index):.2f} {units[index]}"


def _normalize_newlines(text: str) -> str:
    return text.replace("\r\n", "\n").replace("\r", "\n")


def _ts(seconds: float) -> str:
    return datetime.fromtimestamp(seconds).isoformat(timespec="seconds")


def _glob_match(relative: str, pattern: str) -> bool:
    rel = relative.replace("\\", "/").strip("/")
    pat = pattern.replace("\\", "/").strip()
    if not rel or not pat:
        return False
    return PurePosixPath(rel).full_match(pat)


def _excluded(relative: str, patterns: list[str], *, name_anywhere: bool) -> bool:
    for pattern in patterns:
        if _glob_match(relative, pattern):
            return True
        if name_anywhere and "*" not in pattern:
            if _glob_match(relative, f"**/{pattern}") or _glob_match(relative, f"**/{pattern}/**"):
                return True
    return False


def _sandbox_root() -> tuple[Path, None] | tuple[None, str]:
    try:
        return current_sandbox().resolve(), None
    except ValueError as exc:
        return None, str(exc)


def _resolve(path: str, *, action: str) -> tuple[str, None] | tuple[None, str]:
    """相对 → 仅会话内；绝对 → 会话内直通，会话外需人机确认。"""
    try:
        return str(resolve_agent_path(path, action=action)), None
    except ValueError as exc:
        return None, str(exc)


def _read_text(path_str: str, *, action: str = "read_file") -> tuple[str, None] | tuple[None, str]:
    target, err = _resolve(path_str, action=action)
    if err or target is None:
        return None, err or "路径无效"
    path = Path(target)
    if not path.is_file():
        return None, f"不是文件或不存在: {path_str}"
    try:
        size = path.stat().st_size
    except OSError as exc:
        return None, f"读取失败: {exc}"
    if size > _MAX_READ_BYTES:
        return None, f"文件过大（{size} 字节），请用 head 或 tail 分段读取: {path_str}"
    try:
        return path.read_text(encoding="utf-8", newline=""), None
    except UnicodeDecodeError:
        return None, f"不是 UTF-8 文本: {path_str}"
    except OSError as exc:
        return None, f"读取失败: {exc}"


def _head_file(path_str: str, num_lines: int) -> str:
    target, err = _resolve(path_str, action="read_text_file(head)")
    if err or target is None:
        return err or "路径无效"
    path = Path(target)
    if not path.is_file():
        return f"不是文件或不存在: {path_str}"
    if num_lines <= 0:
        return ""
    lines: list[str] = []
    try:
        with path.open("r", encoding="utf-8", errors="replace", newline="") as handle:
            for raw in handle:
                lines.append(_normalize_newlines(raw).rstrip("\n"))
                if len(lines) >= num_lines:
                    break
    except OSError as exc:
        return f"读取失败: {exc}"
    return "\n".join(lines)


def _tail_file(path_str: str, num_lines: int) -> str:
    target, err = _resolve(path_str, action="read_text_file(tail)")
    if err or target is None:
        return err or "路径无效"
    path = Path(target)
    if not path.is_file():
        return f"不是文件或不存在: {path_str}"
    if num_lines <= 0:
        return ""
    try:
        text = _normalize_newlines(path.read_text(encoding="utf-8", errors="replace", newline=""))
    except OSError as exc:
        return f"读取失败: {exc}"
    if not text:
        return ""
    if text.endswith("\n"):
        text = text[:-1]
    return "\n".join(text.split("\n")[-num_lines:])


def _write_text(path_str: str, content: str) -> str:
    target, err = _resolve(path_str, action="write_file")
    if err or target is None:
        return err or "路径无效"
    path = Path(target)
    if not path.parent.is_dir():
        return f"父目录不存在: {path.parent}"
    try:
        if not path.exists():
            try:
                with path.open("x", encoding="utf-8", newline="") as handle:
                    handle.write(content)
                return f"Successfully wrote to {path_str}"
            except FileExistsError:
                pass
        mode = path.stat().st_mode & 0o777
        tmp = path.with_name(f".{path.name}.{secrets.token_hex(8)}.tmp")
        try:
            tmp.write_text(content, encoding="utf-8", newline="")
            os.replace(tmp, path)
        except OSError:
            tmp.unlink(missing_ok=True)
            raise
        try:
            os.chmod(path, mode)
        except OSError:
            pass
    except OSError as exc:
        return f"写入失败: {exc}"
    return f"Successfully wrote to {path_str}"


def _apply_edits(content: str, edits: list[FileEdit]) -> str:
    modified = _normalize_newlines(content)
    for edit in edits:
        old = _normalize_newlines(edit.oldText)
        new = _normalize_newlines(edit.newText)
        if old in modified:
            modified = modified.replace(old, new, 1)
            continue
        old_lines = old.split("\n")
        content_lines = modified.split("\n")
        found = False
        span = len(old_lines)
        for index in range(len(content_lines) - span + 1):
            window = content_lines[index : index + span]
            if not all(left.strip() == right.strip() for left, right in zip(old_lines, window, strict=True)):
                continue
            indent = ""
            matched = re.match(r"^\s*", content_lines[index])
            if matched:
                indent = matched.group(0)
            rewritten: list[str] = []
            for line_index, line in enumerate(new.split("\n")):
                if line_index == 0:
                    rewritten.append(indent + line.lstrip())
                    continue
                old_indent = ""
                if line_index < len(old_lines):
                    old_match = re.match(r"^\s*", old_lines[line_index])
                    old_indent = old_match.group(0) if old_match else ""
                new_match = re.match(r"^\s*", line)
                new_indent = new_match.group(0) if new_match else ""
                if old_indent and new_indent:
                    relative = len(new_indent) - len(old_indent)
                    rewritten.append(indent + (" " * max(0, relative)) + line.lstrip())
                else:
                    rewritten.append(line)
            content_lines[index : index + span] = rewritten
            modified = "\n".join(content_lines)
            found = True
            break
        if not found:
            raise ValueError(f"Could not find exact match for edit:\n{edit.oldText}")
    return modified


def _unified_diff(original: str, modified: str, filepath: str) -> str:
    diff = "".join(
        difflib.unified_diff(
            original.splitlines(keepends=True),
            modified.splitlines(keepends=True),
            fromfile=filepath,
            tofile=filepath,
        )
    )
    if not diff:
        diff = "(无变更)\n"
    ticks = 3
    while "`" * ticks in diff:
        ticks += 1
    return f"{'`' * ticks}diff\n{diff}{'`' * ticks}\n"


def _is_real_dir(path: Path) -> bool:
    return path.is_dir() and not path.is_symlink()


def _read_text_args(path: str, tail: int | None, head: int | None) -> str:
    if tail is not None and head is not None:
        return "不能同时指定 head 和 tail"
    if tail is not None:
        return _tail_file(path, int(tail))
    if head is not None:
        return _head_file(path, int(head))
    text, err = _read_text(path)
    return err or text or ""


@tool
def read_file(
    path: Annotated[str, Field(description=_PATH_FILE)],
    tail: Annotated[int | None, Field(description="只返回最后 N 行；勿与 head 同时使用")] = None,
    head: Annotated[int | None, Field(description="只返回前 N 行；勿与 tail 同时使用")] = None,
) -> str:
    """已废弃，请改用 read_text_file。读取 UTF-8 文本；可选用 head/tail 截取行数。"""
    return _read_text_args(path, tail, head)


@tool
def read_text_file(
    path: Annotated[str, Field(description=_PATH_FILE)],
    tail: Annotated[int | None, Field(description="只返回最后 N 行；勿与 head 同时使用")] = None,
    head: Annotated[int | None, Field(description="只返回前 N 行；勿与 tail 同时使用")] = None,
) -> str:
    """读取单个 UTF-8 文本文件内容。

    大文件请用 head/tail 分段读。head 与 tail 不能同时指定。
    成功返回文件文本；失败返回错误原因。
    """
    return _read_text_args(path, tail, head)


@tool
def read_multiple_files(
    paths: Annotated[
        list[str],
        Field(
            min_length=1,
            description="要读取的文件路径列表（至少 1 个）。每项规则同单文件 path：会话内相对路径，会话外绝对路径。",
        ),
    ],
) -> str:
    """一次读取多个 UTF-8 文本文件。单个失败不中断其余；结果用 --- 分隔。"""
    if not paths:
        return "至少提供一个文件路径"
    chunks: list[str] = []
    for file_path in paths:
        text, err = _read_text(file_path)
        if err:
            chunks.append(f"{file_path}: Error - {err}")
        else:
            chunks.append(f"{file_path}:\n{text}\n")
    return "\n---\n".join(chunks)


@tool
def write_file(
    path: Annotated[
        str,
        Field(
            description=(
                "目标文件路径。用户产物优先写到 output/ 下的相对路径，"
                "例：output/hello.txt。用户指定了扩展名时必须带上。"
                "父目录必须已存在。会话外须绝对路径并确认。"
            )
        ),
    ],
    content: Annotated[
        str,
        Field(description="要写入的完整文本（UTF-8）。会整文件覆盖已存在内容。"),
    ],
) -> str:
    """新建或整文件覆盖写入文本。

    成功返回 Successfully wrote …；失败返回原因（父目录不存在、用户拒绝会话外路径等）。
    """
    return _write_text(path, content)


@tool
def edit_file(
    path: Annotated[str, Field(description=_PATH_FILE)],
    edits: Annotated[
        list[FileEdit],
        Field(description="按顺序的替换列表。每项含 oldText/newText；oldText 优先精确匹配。"),
    ],
    dryRun: Annotated[
        bool,
        Field(description="true=只预览 git diff 不写盘；false=写盘并返回 diff"),
    ] = False,
) -> str:
    """对已有文本文件做精确替换并返回 unified diff。文件必须已存在。"""
    target, err = _resolve(path, action="edit_file")
    if err or target is None:
        return err or "路径无效"
    file_path = Path(target)
    if not file_path.is_file():
        return f"不是文件或不存在: {path}"
    try:
        if file_path.stat().st_size > _MAX_EDIT_BYTES:
            return f"文件过大，无法编辑: {path}"
        original = _normalize_newlines(file_path.read_text(encoding="utf-8", newline=""))
    except UnicodeDecodeError:
        return f"不是 UTF-8 文本: {path}"
    except OSError as exc:
        return f"读取失败: {exc}"
    try:
        modified = _apply_edits(original, edits)
    except ValueError as exc:
        return str(exc)
    diff = _unified_diff(original, modified, path)
    if dryRun:
        return diff
    written = _write_text(path, modified)
    if not written.startswith("Successfully wrote"):
        return written
    return diff


@tool
def create_directory(
    path: Annotated[
        str,
        Field(description="要创建的目录路径，可含多级。会话内例：output/notes。已存在视为成功。"),
    ],
) -> str:
    """创建目录（含缺失的父目录）。已存在则成功返回。"""
    target, err = _resolve(path, action="create_directory")
    if err or target is None:
        return err or "路径无效"
    directory = Path(target)
    try:
        directory.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        return f"创建目录失败: {exc}"
    if not directory.is_dir():
        return f"创建目录失败: {path}"
    return f"Successfully created directory {path}"


@tool
def list_directory(
    path: Annotated[str, Field(description=_PATH_DIR)],
) -> str:
    """列出目录下一层子项。每行前缀 [DIR] 或 [FILE]。不递归。"""
    target, err = _resolve(path, action="list_directory")
    if err or target is None:
        return err or "路径无效"
    directory = Path(target)
    if not directory.is_dir():
        return f"不是目录或不存在: {path}"
    try:
        entries = sorted(directory.iterdir(), key=lambda item: item.name)
    except OSError as exc:
        return f"列出目录失败: {exc}"
    lines = [f"{'[DIR]' if _is_real_dir(item) else '[FILE]'} {item.name}" for item in entries]
    return "\n".join(lines)


@tool
def list_directory_with_sizes(
    path: Annotated[str, Field(description=_PATH_DIR)],
    sortBy: Annotated[
        Literal["name", "size"],
        Field(description="排序：name=按名称；size=按文件大小从大到小（目录无大小）"),
    ] = "name",
) -> str:
    """列出目录下一层子项并附文件大小与合计。不递归。"""
    target, err = _resolve(path, action="list_directory_with_sizes")
    if err or target is None:
        return err or "路径无效"
    directory = Path(target)
    if not directory.is_dir():
        return f"不是目录或不存在: {path}"
    rows: list[tuple[str, bool, int]] = []
    try:
        children = list(directory.iterdir())
    except OSError as exc:
        return f"列出目录失败: {exc}"
    for item in children:
        is_dir = _is_real_dir(item)
        try:
            size = item.stat().st_size
        except OSError:
            size = 0
        rows.append((item.name, is_dir, size))
    if sortBy == "size":
        rows.sort(key=lambda row: row[2], reverse=True)
    else:
        rows.sort(key=lambda row: row[0])
    lines = [
        f"{'[DIR]' if is_dir else '[FILE]'} {name.ljust(30)} {'' if is_dir else _format_size(size).rjust(10)}"
        for name, is_dir, size in rows
    ]
    file_count = sum(1 for _, is_dir, _ in rows if not is_dir)
    dir_count = sum(1 for _, is_dir, _ in rows if is_dir)
    total = sum(size for _, is_dir, size in rows if not is_dir)
    lines.extend(["", f"Total: {file_count} files, {dir_count} directories", f"Combined size: {_format_size(total)}"])
    return "\n".join(lines)


@tool
def directory_tree(
    path: Annotated[str, Field(description=_PATH_DIR)],
    excludePatterns: Annotated[
        list[str] | None,
        Field(description="要排除的 glob，相对搜索起点。例：node_modules、*.log、**/dist/**"),
    ] = None,
) -> str:
    """递归返回目录树 JSON（name/type/children）。过深会截断。"""
    target, err = _resolve(path, action="directory_tree")
    if err or target is None:
        return err or "路径无效"
    root = Path(target)
    if not root.is_dir():
        return f"不是目录或不存在: {path}"
    patterns = list(excludePatterns or [])
    budget = _MAX_WALK

    def build(current: Path) -> list[dict[str, object]]:
        nonlocal budget
        nodes: list[dict[str, object]] = []
        try:
            entries = sorted(current.iterdir(), key=lambda item: item.name)
        except OSError as exc:
            return [{"name": f"(无法读取: {exc})", "type": "file"}]
        for entry in entries:
            if budget <= 0:
                nodes.append({"name": "…(已截断)", "type": "file"})
                break
            relative = entry.relative_to(root).as_posix()
            if _excluded(relative, patterns, name_anywhere=True):
                continue
            budget -= 1
            is_dir = _is_real_dir(entry)
            node: dict[str, object] = {"name": entry.name, "type": "directory" if is_dir else "file"}
            if is_dir:
                node["children"] = build(entry)
            nodes.append(node)
        return nodes

    return json.dumps(build(root), ensure_ascii=False, indent=2)


@tool
def move_file(
    source: Annotated[str, Field(description=f"源路径。{_PATH}")],
    destination: Annotated[
        str,
        Field(description="目标路径（含新文件名）。目标不得已存在，不会覆盖。父目录须已存在。"),
    ],
) -> str:
    """移动或重命名文件/目录。目标已存在则失败。"""
    src, src_err = _resolve(source, action="move_file(source)")
    dest, dest_err = _resolve(destination, action="move_file(destination)")
    if src_err or src is None:
        return src_err or "路径无效"
    if dest_err or dest is None:
        return dest_err or "路径无效"
    src_path = Path(src)
    dest_path = Path(dest)
    if not src_path.exists():
        return f"源路径不存在: {source}"
    if not dest_path.parent.is_dir():
        return f"目标父目录不存在: {dest_path.parent}"
    try:
        dest_path.lstat()
    except FileNotFoundError:
        pass
    else:
        return f"Destination already exists: {destination}"
    try:
        os.rename(src_path, dest_path)
    except OSError as exc:
        return f"移动失败: {exc}"
    return f"Successfully moved {source} to {destination}"


@tool
def search_files(
    path: Annotated[str, Field(description=f"搜索起点目录或文件。{_PATH_DIR}")],
    pattern: Annotated[
        str,
        Field(
            description=(
                "相对起点的 glob。"
                "例：*.txt 只匹配当前层；**/*.txt 匹配所有子目录；notes/** 匹配 notes 下所有。"
            )
        ),
    ],
    excludePatterns: Annotated[
        list[str] | None,
        Field(description="排除的 glob 列表，相对搜索起点。例：['*.log','**/node_modules/**']"),
    ] = None,
) -> str:
    """按 glob 递归查找，返回匹配项的绝对路径（每行一个）。无匹配则返回 No matches found。"""
    target, err = _resolve(path, action="search_files")
    if err or target is None:
        return err or "路径无效"
    root = Path(target)
    if not root.exists():
        return f"路径不存在: {path}"
    patterns = list(excludePatterns or [])
    hits: list[str] = []
    root_resolved = root.resolve()

    def walk(current: Path) -> bool:
        try:
            entries = list(current.iterdir())
        except OSError:
            return False
        for entry in entries:
            if len(hits) >= _MAX_WALK:
                hits.append("…(已截断)")
                return True
            try:
                checked_path = entry.resolve()
                checked_path.relative_to(root_resolved)
                checked = str(checked_path)
            except ValueError:
                continue
            relative = entry.relative_to(root).as_posix()
            if _excluded(relative, patterns, name_anywhere=False):
                continue
            if _glob_match(relative, pattern):
                hits.append(checked)
            if _is_real_dir(entry) and walk(entry):
                return True
        return False

    if root.is_file():
        relative = root.name
        if _glob_match(relative, pattern) and not _excluded(relative, patterns, name_anywhere=False):
            hits.append(str(root.resolve()))
    else:
        walk(root)
    return "\n".join(hits) if hits else "No matches found"


@tool
def get_file_info(
    path: Annotated[str, Field(description=_PATH)],
) -> str:
    """返回大小、创建/修改/访问时间、类型与权限。不读取文件内容。"""
    target, err = _resolve(path, action="get_file_info")
    if err or target is None:
        return err or "路径无效"
    file_path = Path(target)
    if not file_path.exists():
        return f"路径不存在: {path}"
    try:
        info = file_path.stat()
    except OSError as exc:
        return f"读取信息失败: {exc}"
    created = getattr(info, "st_birthtime", info.st_ctime)
    rows = {
        "size": info.st_size,
        "created": _ts(created),
        "modified": _ts(info.st_mtime),
        "accessed": _ts(info.st_atime),
        "isDirectory": str(stat.S_ISDIR(info.st_mode)).lower(),
        "isFile": str(stat.S_ISREG(info.st_mode)).lower(),
        "permissions": f"{info.st_mode & 0o777:03o}",
    }
    return "\n".join(f"{key}: {value}" for key, value in rows.items())


@tool
def list_allowed_directories() -> str:
    """返回当前会话根（可直接访问、无需确认）。会话外访问须绝对路径并等人确认。"""
    root, err = _sandbox_root()
    if err or root is None:
        return err or "当前没有会话工作区"
    return (
        f"Allowed directories (no prompt):\n{root}\n"
        "Outside this tree: pass an absolute path; the UI will ask for confirmation."
    )


def _open_in_file_manager(path_str: str) -> None:
    if sys.platform == "win32":
        os.startfile(path_str)  # type: ignore[attr-defined]  # noqa: S606
        return
    command = ["open", path_str] if sys.platform == "darwin" else ["xdg-open", path_str]
    subprocess.Popen(command)  # noqa: S603


@tool
def open_folder(
    path: Annotated[str, Field(description=_PATH_DIR)] = ".",
) -> str:
    """在系统文件管理器中打开目录。若 path 指向文件，则打开其所在目录。"""
    target, err = _resolve(path, action="open_folder")
    if err or target is None:
        return err or "路径无效"
    file_path = Path(target)
    if not file_path.exists():
        return f"路径不存在: {path}"
    folder = file_path if _is_real_dir(file_path) else file_path.parent
    try:
        _open_in_file_manager(str(folder))
    except OSError as exc:
        return f"打开文件夹失败: {exc}"
    return f"已在文件管理器中打开: {folder}"


@tool
def delete_path(
    path: Annotated[
        str,
        Field(
            description=(
                "要删除的文件或目录路径。目录会连同内容删除。"
                "不能传 . 或空（禁止删会话根）。会话外须绝对路径并确认。"
            )
        ),
    ],
) -> str:
    """删除文件或目录。不可恢复；不能删除会话根。"""
    if (path or "").strip() in {"", ".", "./", ".\\"}:
        return "不能删除会话工作区根目录"
    sandbox, sandbox_err = _sandbox_root()
    if sandbox_err or sandbox is None:
        return sandbox_err or "当前没有会话工作区"
    target, err = _resolve(path, action="delete_path")
    if err or target is None:
        return err or "路径无效"
    lexical = Path(target)
    if lexical == sandbox:
        return "不能删除会话工作区根目录"
    if not lexical.exists() and not lexical.is_symlink():
        return f"路径不存在: {path}"
    try:
        if lexical.is_symlink():
            lexical.unlink()
        elif lexical.is_dir():
            shutil.rmtree(lexical)
        else:
            lexical.unlink()
    except OSError as exc:
        return f"删除失败: {exc}"
    return f"已删除: {path}"


TOOLS: tuple[BaseTool, ...] = (
    read_file,
    read_text_file,
    read_multiple_files,
    write_file,
    edit_file,
    create_directory,
    list_directory,
    list_directory_with_sizes,
    directory_tree,
    move_file,
    search_files,
    get_file_info,
    list_allowed_directories,
    open_folder,
    delete_path,
)


def heuristic(text: str) -> list[str]:
    names: list[str] = []
    if any(k in text for k in ("允许目录", "工作区根", "workspace", "沙箱根", "allowed director")):
        names.append("list_allowed_directories")
    if any(k in text for k in ("目录树", "directory tree", "树形", "tree ")):
        names.append("directory_tree")
    if any(k in text for k in ("文件大小", "占用空间", "with sizes", "按大小")):
        names.append("list_directory_with_sizes")
    if any(k in text for k in ("列出", "列目录", "ls ", "list dir", "有哪些文件", "目录内容")):
        names.append("list_directory")
    if any(k in text for k in ("多个文件", "同时读", "批量读", "read multiple")):
        names.append("read_multiple_files")
    if any(k in text for k in ("读文件", "打开文件", "查看文件", "read file", "读取", "前几行", "最后几行")):
        names.append("read_text_file")
    if any(k in text for k in ("编辑文件", "修改文件", "替换文本", "edit file", "打补丁")):
        names.append("edit_file")
    if any(k in text for k in (
        "写文件", "保存到", "创建文件", "生成文件", "write file", "写入", "覆盖文件",
    )) or ("生成" in text and "文件" in text):
        names.append("write_file")
    if any(k in text for k in ("创建目录", "新建文件夹", "mkdir", "建目录")):
        names.append("create_directory")
    if any(k in text for k in ("移动文件", "重命名", "move file", "rename")):
        names.append("move_file")
    if any(k in text for k in ("找文件", "glob", "搜索文件", "匹配文件", "*.md", "*.txt", "search files")):
        names.append("search_files")
    if any(k in text for k in ("文件信息", "元数据", "修改时间", "file info", "权限")):
        names.append("get_file_info")
    if any(k in text for k in ("打开文件夹", "资源管理器", "文件管理器", "explorer", "在文件夹中打开")):
        names.append("open_folder")
    if any(k in text for k in ("删除文件", "删除文件夹", "删除目录", "删掉", "删文件", "删文件夹", "delete file", "rmdir")):
        names.append("delete_path")
    return names
