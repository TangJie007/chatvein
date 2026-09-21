"""文件系统工具（沙箱内）。

行为对齐 ``@modelcontextprotocol/server-filesystem``，不包含 ``read_media_file``。
另加 ``open_folder``（在文件管理器中打开目录）和 ``delete_path``（删除文件或文件夹）。
允许目录只有一个：设置页里的主空间，否则数据目录下的 ``workspace``。
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

from mcps.workspace import (  # pyright: ignore[reportImplicitRelativeImport]
    resolve_in_workspace,
    workspace_root,
)

_MAX_READ_BYTES = 512_000
_MAX_EDIT_BYTES = 2_000_000
_MAX_WALK = 2_000


class FileEdit(BaseModel):
    oldText: str = Field(description="要精确匹配的原文")
    newText: str = Field(description="替换成的新文本")


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


def _resolve(path: str) -> tuple[str, None] | tuple[None, str]:
    try:
        return str(resolve_in_workspace(path)), None
    except ValueError as exc:
        return None, str(exc)


def _read_text(path_str: str) -> tuple[str, None] | tuple[None, str]:
    target, err = _resolve(path_str)
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
    target, err = _resolve(path_str)
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
    target, err = _resolve(path_str)
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
    target, err = _resolve(path_str)
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
    path: str,
    tail: Annotated[int | None, Field(description="若提供，只返回文件最后 N 行")] = None,
    head: Annotated[int | None, Field(description="若提供，只返回文件前 N 行")] = None,
) -> str:
    """读取文本文件的全部内容。已废弃：请改用 read_text_file。不能同时指定 head 和 tail。仅限工作区。"""
    return _read_text_args(path, tail, head)


@tool
def read_text_file(
    path: str,
    tail: Annotated[int | None, Field(description="若提供，只返回文件最后 N 行")] = None,
    head: Annotated[int | None, Field(description="若提供，只返回文件前 N 行")] = None,
) -> str:
    """按 UTF-8 读取工作区内的单个文本文件。可用 head 只读前 N 行，或 tail 只读最后 N 行，二者不能同时指定。超大文件请分段读取。"""
    return _read_text_args(path, tail, head)


@tool
def read_multiple_files(
    paths: Annotated[list[str], Field(min_length=1, description="要读取的文件路径列表，至少一项，且都必须在工作区内")],
) -> str:
    """一次读取多个文本文件。单个文件失败不会中断其余文件。仅限工作区。"""
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
def write_file(path: str, content: str) -> str:
    """新建或完全覆盖工作区内的文本文件。父目录必须已存在，已有文件会被覆盖。不跟随逃出工作区的符号链接。"""
    return _write_text(path, content)


@tool
def edit_file(
    path: str,
    edits: Annotated[list[FileEdit], Field(description="按顺序应用的替换；oldText 需精确匹配，找不到时会放宽为忽略首尾空白的逐行匹配")],
    dryRun: Annotated[bool, Field(description="为 true 时只返回 git diff，不写盘")] = False,
) -> str:
    """对文本文件做若干次精确替换，并返回 git 风格 diff。dryRun 为 true 时只预览不写盘。仅限工作区。"""
    target, err = _resolve(path)
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
def create_directory(path: str) -> str:
    """创建目录（含多级父目录）。目录已存在时视为成功。仅限工作区。"""
    target, err = _resolve(path)
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
def list_directory(path: str) -> str:
    """列出目录的直接子项。目录前缀 [DIR]，其余为 [FILE]（含指向目录的符号链接）。仅限工作区。"""
    target, err = _resolve(path)
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
    path: str,
    sortBy: Annotated[Literal["name", "size"], Field(description="按名称或大小排序；size 为从大到小")] = "name",
) -> str:
    """列出目录直接子项，文件附带大小。目录显示为 [DIR] 且不计入体积。仅限工作区。"""
    target, err = _resolve(path)
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
    path: str,
    excludePatterns: Annotated[
        list[str] | None,
        Field(description="排除的 glob；无 * 时按名称匹配任意层级（如 node_modules）"),
    ] = None,
) -> str:
    """递归返回目录树 JSON。目录含 children（可为空），文件没有 children。仅限工作区。"""
    target, err = _resolve(path)
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
def move_file(source: str, destination: str) -> str:
    """在工作区内移动或重命名文件/目录。目标已存在则失败，不会覆盖。"""
    src, src_err = _resolve(source)
    dest, dest_err = _resolve(destination)
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
    path: str,
    pattern: str,
    excludePatterns: Annotated[
        list[str] | None,
        Field(description="排除的 glob，相对搜索起点。如 *.log 或 **/node_modules/**"),
    ] = None,
) -> str:
    """按 glob 递归查找文件和目录。*.ext 只匹配当前层，**/*.ext 匹配所有子目录。返回绝对路径。仅限工作区。"""
    target, err = _resolve(path)
    if err or target is None:
        return err or "路径无效"
    root = Path(target)
    if not root.exists():
        return f"路径不存在: {path}"
    patterns = list(excludePatterns or [])
    hits: list[str] = []

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
                checked = resolve_in_workspace(str(entry))
            except ValueError:
                continue
            relative = entry.relative_to(root).as_posix()
            if _excluded(relative, patterns, name_anywhere=False):
                continue
            if _glob_match(relative, pattern):
                hits.append(str(checked))
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
def get_file_info(path: str) -> str:
    """返回文件或目录的大小、创建/修改/访问时间、权限和类型。不读取内容。仅限工作区。"""
    target, err = _resolve(path)
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
    """返回本服务允许访问的目录。工作区内的子路径都可以访问。"""
    root = workspace_root()
    return f"Allowed directories:\n{root}"


def _open_in_file_manager(path_str: str) -> None:
    if sys.platform == "win32":
        os.startfile(path_str)  # type: ignore[attr-defined]  # noqa: S606
        return
    command = ["open", path_str] if sys.platform == "darwin" else ["xdg-open", path_str]
    subprocess.Popen(command)  # noqa: S603


@tool
def open_folder(path: str = ".") -> str:
    """在系统文件管理器中打开工作区内的文件夹。若 path 是文件，则打开其所在目录。"""
    target, err = _resolve(path)
    if err or target is None:
        return err or "路径无效"
    file_path = Path(target)
    if not file_path.exists():
        return f"路径不存在: {path}"
    folder = file_path if _is_real_dir(file_path) else file_path.parent
    try:
        folder.relative_to(workspace_root())
    except ValueError:
        return f"路径越界工作区: {path}"
    try:
        _open_in_file_manager(str(folder))
    except OSError as exc:
        return f"打开文件夹失败: {exc}"
    return f"已在文件管理器中打开: {folder}"


@tool
def delete_path(path: str) -> str:
    """删除工作区内的文件或文件夹。文件夹会连同其中内容一起删除。不能删除主空间根目录。符号链接只删除链接本身。"""
    if (path or "").strip() in {"", ".", "./", ".\\"}:
        return "不能删除主空间根目录"
    root = workspace_root()
    candidate = Path(path.strip())
    lexical = candidate if candidate.is_absolute() else root / candidate
    lexical = Path(os.path.abspath(lexical))
    try:
        lexical.relative_to(root)
    except ValueError:
        return f"路径越界工作区: {path}"
    if lexical == root:
        return "不能删除主空间根目录"
    if lexical.parent != root:
        parent, parent_err = _resolve(str(lexical.parent))
        if parent_err or parent is None:
            if parent_err and "越界" in parent_err:
                return f"路径越界工作区: {path}"
            return parent_err or "路径无效"
        try:
            Path(parent).relative_to(root)
        except ValueError:
            return f"路径越界工作区: {path}"
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
    if any(k in text for k in ("写文件", "保存到", "创建文件", "write file", "写入", "覆盖文件")):
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
