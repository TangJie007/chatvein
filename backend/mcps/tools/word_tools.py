"""Word 文档生成/编辑工具（mcp-docx）。

实现分层：
- 直接基于 ``python-docx`` 原生 OOXML 操作，不依赖 MS Word / LibreOffice。
- 生成侧：接收文本 + 结构（heading/body/list/quote/table/code），落为 .docx。
- 编辑侧：按精确替换（find → replace）无损改文本；未触及内容保持原样。

约定：
- 路径规则沿用 ``resolve_agent_path``：会话内相对路径直通，会话外绝对路径需人机确认。
- 中文字体：python-docx 默认样式，实际渲染由打开方（Word / WPS / LibreOffice）决定。
"""

from __future__ import annotations

from pathlib import Path
from typing import Annotated, Any

from langchain_core.tools import BaseTool, tool
from pydantic import Field

from mcps.path_access import resolve_agent_path  # pyright: ignore[reportImplicitRelativeImport]

_PATH_DOC = "文件路径。会话内推荐相对路径（例：output/report.docx）；会话外必须绝对路径并需用户确认。"


def _resolve(path: str, *, action: str) -> tuple[Path, None] | tuple[None, str]:
    try:
        return resolve_agent_path(path, action=action), None
    except ValueError as exc:
        return None, str(exc)


def _import_docx() -> tuple[Any, Any, None] | tuple[None, None, str]:
    try:
        from docx import Document  # type: ignore[import-untyped]
        from docx.shared import Pt  # type: ignore[import-untyped]
        return Document, Pt, None
    except ImportError as exc:  # pragma: no cover
        return None, None, f"缺少依赖 python-docx: {exc}"


def _ensure_parent(path: Path) -> str | None:
    if path.parent and not path.parent.is_dir():
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            return None
        except OSError as exc:
            return f"创建父目录失败: {exc}"
    return None


def _add_heading(doc: Any, text: str, level: int, Pt: Any) -> None:
    style = f"Heading {max(1, min(6, level))}"
    try:
        doc.add_heading(text, level=max(1, min(6, level)))
    except Exception:  # noqa: BLE001
        doc.add_paragraph(text)
    _ = Pt, style  # 保留签名兼容性


def _parse_blocks(text: str) -> list[tuple[str, str, Any]]:
    """把 Markdown-lite 文本切成 (kind, content, level) 三元组。

    支持：
    - ``# / ## / ###`` → heading
    - ``- / *`` → bullet
    - ``1. / 2.`` → numbered
    - ``>`` → quote
    - 其他 → paragraph
    """
    blocks: list[tuple[str, str, Any]] = []
    for raw in (text or "").split("\n"):
        line = raw.rstrip()
        if not line.strip():
            continue
        stripped = line.lstrip()
        if stripped.startswith("#"):
            level = len(stripped) - len(stripped.lstrip("#"))
            content = stripped.lstrip("#").strip()
            blocks.append(("heading", content, min(6, max(1, level))))
        elif stripped.startswith("- ") or stripped.startswith("* "):
            blocks.append(("bullet", stripped[2:].strip(), None))
        elif stripped.startswith(">"):
            blocks.append(("quote", stripped.lstrip("> ").strip(), None))
        elif len(stripped) > 1 and stripped[0].isdigit() and stripped[1:3].lstrip(". ").startswith("."):
            blocks.append(("numbered", stripped[2:].strip(), None))
        elif len(stripped) > 2 and stripped[1] == "." and stripped[0].isdigit():
            blocks.append(("numbered", stripped[2:].strip(), None))
        else:
            blocks.append(("paragraph", stripped, None))
    return blocks


@tool
def generate_word_document(
    text: Annotated[str, Field(description="文档正文。支持 Markdown-lite：# 标题 / - 列表 / > 引用 / 1. 有序列表。")],
    output: Annotated[str, Field(description=f"输出 .docx 路径。{_PATH_DOC}")],
    title: Annotated[str | None, Field(description="可选标题（写入首段 Heading 1）。若 text 首行已是 # 标题则忽略。")] = None,
) -> str:
    """根据文本生成 Word 文档（.docx）。适合报告、说明、正文类文档。"""
    Document, _Pt, err = _import_docx()
    if err:
        return err
    assert Document is not None  # err 非空时已在上方返回，此处必为导入成功
    if not text or not text.strip():
        return "text 不能为空"
    target, err = _resolve(output, action="generate_word_document")
    if err or target is None:
        return err or "路径无效"
    parent_err = _ensure_parent(target)
    if parent_err:
        return parent_err

    try:
        doc = Document()
        blocks = _parse_blocks(text)
        consumed_title = False
        if title and not blocks:
            doc.add_heading(title, level=1)
            consumed_title = True
        elif title and blocks and blocks[0][0] != "heading":
            doc.add_heading(title, level=1)
            consumed_title = True
        for kind, content, level in blocks:
            if kind == "heading":
                doc.add_heading(content, level=int(level or 2))
            elif kind == "bullet":
                doc.add_paragraph(content, style="List Bullet")
            elif kind == "numbered":
                doc.add_paragraph(content, style="List Number")
            elif kind == "quote":
                doc.add_paragraph(content, style="Intense Quote")
            else:
                doc.add_paragraph(content)
        if not consumed_title and title and blocks and blocks[0][0] == "heading" and blocks[0][2] == 1:
            pass
        doc.save(str(target))
    except Exception as exc:  # noqa: BLE001
        return f"生成 Word 失败: {exc}"
    return f"已生成 Word 文档: {target}"


@tool
def edit_word_document(
    path: Annotated[str, Field(description=f"已存在的 .docx 文件路径。{_PATH_DOC}")],
    replacements: Annotated[
        list[dict[str, str]],
        Field(
            description=(
                "替换列表，按顺序执行。每项形如 {\"find\": \"原文\", \"replace\": \"新文\"}。"
                "find 精确匹配，未找到视为该条失败但不中断其余替换。"
            )
        ),
    ],
    output: Annotated[
        str | None,
        Field(description="可选输出路径（默认覆盖原文件）。"),
    ] = None,
) -> str:
    """按精确替换编辑已有 Word 文档。未触及内容保持原样（无损）。"""
    Document, _Pt, err = _import_docx()
    if err:
        return err
    assert Document is not None  # err 非空时已在上方返回，此处必为导入成功
    if not replacements:
        return "replacements 不能为空"
    src, err = _resolve(path, action="edit_word_document")
    if err or src is None:
        return err or "路径无效"
    src_path = src
    if not src_path.is_file():
        return f"源文件不存在: {path}"

    dst_path = src_path
    if output:
        dst_path, err = _resolve(output, action="edit_word_document(output)")
        if err or dst_path is None:
            return err or "输出路径无效"
        parent_err = _ensure_parent(dst_path)
        if parent_err:
            return parent_err

    try:
        doc = Document(str(src_path))
        applied = 0
        for item in replacements:
            find = str(item.get("find") or "")
            replace = str(item.get("replace") or "")
            if not find:
                continue
            hit = False
            for para in doc.paragraphs:
                if find in para.text:
                    for run in para.runs:
                        if find in run.text:
                            run.text = run.text.replace(find, replace)
                            hit = True
            if hit:
                applied += 1
        doc.save(str(dst_path))
    except Exception as exc:  # noqa: BLE001
        return f"编辑 Word 失败: {exc}"
    return f"已编辑: {dst_path}（应用 {applied}/{len(replacements)} 处替换）"


TOOLS: tuple[BaseTool, ...] = (generate_word_document, edit_word_document)


def heuristic(text: str) -> list[str]:
    t = (text or "").lower().replace(" ", "").replace("\u3000", "")
    names: list[str] = []
    if any(k in t for k in ("生成word", "生成docx", "写一份报告", "导出word", "生成word文档", "生成docx文档", "做一份word", "做一份docx", "word文档", "docx文档")):
        names.append("generate_word_document")
    if any(k in t for k in ("改word", "编辑word", "改docx", "编辑docx", "修改docx", "修改word")):
        names.append("edit_word_document")
    return names
