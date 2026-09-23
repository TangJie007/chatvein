"""PDF 处理工具（mcp-pdf）。

实现分层：
- 读取侧用 ``pypdf``（纯 Python、轻量）：文本提取 / 元信息 / 合并 / 拆分 / 加解密。
- 生成侧用 ``reportlab``（纯 Python）把文本落成 PDF；中文字体用内置 CID 字体
  ``STSong-Light``，不依赖本机字体文件，打包体积可控。

约定：
- 输入输出路径沿用 ``mcp-fs`` 的 ``resolve_agent_path`` 规则：会话内相对路径直通，
  会话外绝对路径需人机确认。
- 文本提取结果受 ``max_chars`` 限制，防止超大 PDF 撑爆上下文；页数 / 文件大小亦有上限。
- 扫描件（无文本层）不做渲染成图，检测到后返回提示，配合 ``ocr_image`` 使用。
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Annotated

from langchain_core.tools import BaseTool, tool
from pydantic import Field

from mcps.path_access import resolve_agent_path  # pyright: ignore[reportImplicitRelativeImport]

_MAX_BYTES = 100 * 1024 * 1024
_MAX_PAGES = 400
_MAX_MERGE_FILES = 20
_MAX_CHARS = 100_000
_DEFAULT_CHARS = 20_000


def _resolve(path: str, *, action: str) -> tuple[Path, None] | tuple[None, str]:
    try:
        return resolve_agent_path(path, action=action), None
    except ValueError as exc:
        return None, str(exc)


def _open_reader(path_str: str) -> tuple[object, None] | tuple[None, str]:
    """打开 PDF 并校验大小 / 页数 / 加密（加密需先解密，由调用方处理）。"""
    try:
        from pypdf import PdfReader
    except ImportError as exc:  # pragma: no cover
        return None, f"缺少依赖 pypdf: {exc}"

    target, err = _resolve(path_str, action="pdf")
    if err or target is None:
        return None, err or "路径无效"
    path = Path(target)
    if not path.is_file():
        return None, f"不是文件或不存在: {path_str}"
    try:
        size = path.stat().st_size
    except OSError as exc:
        return None, f"读取文件信息失败: {exc}"
    if size > _MAX_BYTES:
        return None, f"文件过大（{size} 字节，上限 {_MAX_BYTES}）: {path_str}"
    try:
        reader = PdfReader(str(path))
    except Exception as exc:  # noqa: BLE001
        return None, f"解析 PDF 失败: {exc}"
    try:
        page_count = len(reader.pages)
    except Exception:  # noqa: BLE001  # 加密未解密时访问 pages 会抛 FileNotDecryptedError
        page_count = 0
    if page_count > _MAX_PAGES:
        return None, f"页数过多（{page_count}，上限 {_MAX_PAGES}）: {path_str}"
    return reader, None


def _parse_pages(spec: str, page_count: int) -> tuple[list[int], None] | tuple[None, str]:
    """把 ``"1-3,5,8"``（1-indexed）解析成 0-indexed 页列表。"""
    parts = [part.strip() for part in (spec or "").split(",") if part.strip()]
    if not parts:
        return None, "pages 不能为空，例: 1-3,5,8"
    selected: set[int] = set()
    for part in parts:
        m = re.fullmatch(r"(\d+)(?:-(\d+))?", part)
        if not m:
            return None, f"无法识别的页范围: {part}（支持 1-3、5、8-9 这类写法）"
        start = int(m.group(1))
        end = int(m.group(2)) if m.group(2) else start
        if start < 1 or end < start or end > page_count:
            return None, f"页范围越界: {part}（共 {page_count} 页，1-indexed）"
        selected.update(range(start - 1, end))
    return sorted(selected), None


def _write_pdf(path_str: str, writer: object) -> str:
    target, err = _resolve(path_str, action="pdf 输出")
    if err or target is None:
        return err or "路径无效"
    out = Path(target)
    if not out.parent.is_dir():
        return f"父目录不存在: {out.parent}"
    try:
        with out.open("wb") as handle:
            writer.write(handle)
    except Exception as exc:  # noqa: BLE001
        return f"写出 PDF 失败: {exc}"
    return f"已写出: {out}"


def _summary(reader: object) -> dict[str, object]:
    """加密文件不读 metadata（会抛 FileNotDecryptedError），只回加密标记。"""
    encrypted = bool(getattr(reader, "is_encrypted", False))
    try:
        pages = len(reader.pages)
    except Exception:  # noqa: BLE001
        pages = 0
    info: dict[str, object] = {"pages": pages, "encrypted": encrypted}
    if encrypted:
        return info
    meta = getattr(reader, "metadata", None) or {}
    for key in ("title", "author", "creator"):
        try:
            value = str(meta.get(key) or "").strip()
        except Exception:  # noqa: BLE001
            value = ""
        if value:
            info[key] = value
    return info


@tool
def pdf_info(path: str) -> str:
    """读取 PDF 元信息：页数、是否加密、标题 / 作者 / 创建者。

    ``path``：会话内相对路径或会话外绝对路径（需确认）。
    不提取正文；想看正文用 ``pdf_read``。
    """
    reader, err = _open_reader(path)
    if err or reader is None:
        return err or "解析失败"
    info = _summary(reader)
    lines = [f"- 页数: {'未知（已加密）' if info['encrypted'] else info['pages']}", f"- 加密: {info['encrypted']}"]
    for key in ("title", "author", "creator"):
        if info.get(key):
            lines.append(f"- {key}: {info[key]}")
    if info["encrypted"]:
        lines.append("- 提示: 需先 pdf_decrypt 才能读取正文")
    return "\n".join(lines)


@tool
def pdf_read(
    path: Annotated[str, Field(description="PDF 路径。会话内相对路径；会话外绝对路径并确认。")],
    pages: Annotated[
        str | None,
        Field(description="可选，只提取指定页，1-indexed。例：'1-3'、'5'、'1-3,8'。省略则提取全部。"),
    ] = None,
    max_chars: Annotated[
        int | None,
        Field(description="可选，返回文本上限字符数（默认 20000，上限 100000）。"),
    ] = None,
) -> str:
    """提取 PDF 文本层文字，按页输出并标页码。

    无文本层（扫描件）时提取结果接近空，会返回提示建议配合 ``ocr_image``。
    大 PDF 请用 ``pages`` 分页读，或用 ``max_chars`` 截断。
    """
    reader, err = _open_reader(path)
    if err or reader is None:
        return err or "解析失败"
    if getattr(reader, "is_encrypted", False):
        return f"文件已加密，请先用 pdf_decrypt 解密: {path}"

    page_count = len(reader.pages)
    if pages:
        selected, spec_err = _parse_pages(pages, page_count)
        if spec_err:
            return spec_err
    else:
        selected = list(range(page_count))

    limit = min(max_chars or _DEFAULT_CHARS, _MAX_CHARS)
    chunks: list[str] = []
    total = 0
    for index in selected:
        try:
            text = str(reader.pages[index].extract_text() or "")
        except Exception as exc:  # noqa: BLE001
            text = f"(第 {index + 1} 页提取失败: {exc})"
        block = f"--- 第 {index + 1} 页 ---\n{text.strip()}"
        chunks.append(block)
        total += len(block)
        if total >= limit:
            chunks.append(f"…(已截断，达到 {limit} 字符上限，可用 pages 分段读取)")
            break

    body = "\n".join(chunks)
    if len(body.strip()) <= len(chunks) * 30:
        return (
            f"该 PDF 疑似扫描件（共 {page_count} 页，提取到文本极少）。\n"
            f"当前 mcp-pdf 不做渲染成图；如需识别内容，请先把页面转为图片后用 ocr_image。\n\n{body or '(无文本层)'}"
        )
    return body


@tool
def pdf_merge(
    paths: Annotated[
        list[str],
        Field(description="要合并的 PDF 路径列表，按给出顺序拼接（至少 1 个）。会话内相对路径，会话外绝对路径。"),
    ],
    output: Annotated[
        str | None,
        Field(description="可选，输出路径。默认 output/merged.pdf。父目录须已存在。"),
    ] = None,
) -> str:
    """把多个 PDF 按顺序合并成一个。原文件不被修改。"""
    if not paths:
        return "至少提供一个 PDF 路径"
    if len(paths) > _MAX_MERGE_FILES:
        return f"一次最多合并 {_MAX_MERGE_FILES} 个文件"
    try:
        from pypdf import PdfWriter
    except ImportError as exc:  # pragma: no cover
        return f"缺少依赖 pypdf: {exc}"

    writer = PdfWriter()
    for item in paths:
        reader, err = _open_reader(item)
        if err or reader is None:
            return err or "解析失败"
        if getattr(reader, "is_encrypted", False):
            return f"加密文件无法合并，请先解密: {item}"
        writer.append(reader)

    dest = output or "output/merged.pdf"
    result = _write_pdf(dest, writer)
    if not result.startswith("已写出"):
        return result
    return f"{result}（共合并 {len(paths)} 个文件，{len(writer.pages)} 页）"


@tool
def pdf_split(
    path: Annotated[str, Field(description="源 PDF 路径。会话内相对路径；会话外绝对路径并确认。")],
    pages: Annotated[
        str,
        Field(description="要保留的页，1-indexed。例：'1-3'、'5'、'1-3,8'。"),
    ],
    output: Annotated[
        str | None,
        Field(description="可选，输出路径。默认 output/{原名}_p{范围}.pdf。父目录须已存在。"),
    ] = None,
) -> str:
    """按页范围拆分 / 抽取 PDF：只保留指定的页，生成新文件。原文件不被修改。"""
    reader, err = _open_reader(path)
    if err or reader is None:
        return err or "解析失败"
    if getattr(reader, "is_encrypted", False):
        return f"文件已加密，请先用 pdf_decrypt 解密: {path}"

    selected, spec_err = _parse_pages(pages, len(reader.pages))
    if spec_err:
        return spec_err
    try:
        from pypdf import PdfWriter
    except ImportError as exc:  # pragma: no cover
        return f"缺少依赖 pypdf: {exc}"

    writer = PdfWriter()
    for index in selected:
        writer.add_page(reader.pages[index])

    if output:
        dest = output
    else:
        stem = Path(path).name or "source"
        if stem.lower().endswith(".pdf"):
            stem = stem[:-4]
        dest = f"output/{stem}_p{pages.replace(',', '-')}.pdf"
    result = _write_pdf(dest, writer)
    if not result.startswith("已写出"):
        return result
    return f"{result}（保留 {len(selected)} 页）"


@tool
def pdf_generate(
    text: Annotated[str, Field(description="要写入 PDF 的正文。空行分段；以 # 开头的行作为标题。")],
    output: Annotated[
        str | None,
        Field(description="可选，输出路径，建议 output/xxx.pdf。默认 output/generated.pdf。父目录须已存在。"),
    ] = None,
) -> str:
    """把纯文本生成 PDF（A4）。支持中英文，标题（# 开头行）加大字号。"""
    body = (text or "").strip()
    if not body:
        return "text 不能为空"
    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import ParagraphStyle
        from reportlab.lib.units import cm
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.cidfonts import UnicodeCIDFont
        from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer
        from xml.sax.saxutils import escape

        pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
    except ImportError as exc:  # pragma: no cover
        return f"缺少依赖 reportlab: {exc}"

    dest = output or "output/generated.pdf"
    target, rerr = _resolve(dest, action="pdf 输出")
    if rerr or target is None:
        return rerr or "路径无效"
    out = Path(target)
    if not out.parent.is_dir():
        return f"父目录不存在: {out.parent}"

    body_style = ParagraphStyle(
        "body", fontName="STSong-Light", fontSize=11, leading=17, wordWrap="CJK"
    )
    title_style = ParagraphStyle(
        "title", parent=body_style, fontSize=15, leading=22, spaceBefore=6, spaceAfter=10
    )

    try:
        doc = SimpleDocTemplate(
            str(out), pagesize=A4, topMargin=2 * cm, bottomMargin=2 * cm, leftMargin=2.5 * cm, rightMargin=2.5 * cm
        )
        story: list[object] = []
        for raw in body.split("\n\n"):
            para = raw.strip()
            if not para:
                continue
            lines = [line.rstrip() for line in para.split("\n")]
            for line in lines:
                if not line:
                    continue
                if line.startswith("# "):
                    style = title_style
                    content = escape(line[2:].strip())
                else:
                    style = body_style
                    content = escape(line)
                story.append(Paragraph(content, style))
                if style is title_style:
                    story.append(Spacer(1, 4))
            story.append(Spacer(1, 8))
        doc.build(story)
    except Exception as exc:  # noqa: BLE001
        return f"生成 PDF 失败: {exc}"
    return f"已生成: {out}"


@tool
def pdf_encrypt(
    path: Annotated[str, Field(description="源 PDF 路径。会话内相对路径；会话外绝对路径并确认。")],
    password: Annotated[str, Field(description="访问口令（owner / user 相同）。空字符串不加密。")],
    output: Annotated[
        str | None,
        Field(description="可选，输出路径。默认 output/{原名}_encrypted.pdf。父目录须已存在。"),
    ] = None,
) -> str:
    """给 PDF 设置打开口令，生成加密副本。原文件不被修改。"""
    if not password:
        return "password 不能为空"
    reader, err = _open_reader(path)
    if err or reader is None:
        return err or "解析失败"
    try:
        from pypdf import PdfWriter
    except ImportError as exc:  # pragma: no cover
        return f"缺少依赖 pypdf: {exc}"

    writer = PdfWriter()
    writer.append(reader)
    writer.encrypt(password)

    if output:
        dest = output
    else:
        stem = Path(path).name or "source"
        if stem.lower().endswith(".pdf"):
            stem = stem[:-4]
        dest = f"output/{stem}_encrypted.pdf"
    result = _write_pdf(dest, writer)
    if not result.startswith("已写出"):
        return result
    return f"{result}（已加密）"


@tool
def pdf_decrypt(
    path: Annotated[str, Field(description="加密 PDF 路径。会话内相对路径；会话外绝对路径并确认。")],
    password: Annotated[str, Field(description="打开口令。")],
    output: Annotated[
        str | None,
        Field(description="可选，输出路径。默认 output/{原名}_decrypted.pdf。父目录须已存在。"),
    ] = None,
) -> str:
    """用口令解开 PDF，生成去加密副本。原文件不被修改。"""
    if not password:
        return "password 不能为空"
    reader, err = _open_reader(path)
    if err or reader is None:
        return err or "解析失败"
    if not getattr(reader, "is_encrypted", False):
        return f"文件未加密，无需解密: {path}"
    try:
        from pypdf import PdfReader, PdfWriter
    except ImportError as exc:  # pragma: no cover
        return f"缺少依赖 pypdf: {exc}"

    if reader.decrypt(password) == 0:  # type: ignore[attr-defined]
        return "口令错误，无法解密"

    writer = PdfWriter()
    writer.append(reader)

    if output:
        dest = output
    else:
        stem = Path(path).name or "source"
        if stem.lower().endswith(".pdf"):
            stem = stem[:-4]
        dest = f"output/{stem}_decrypted.pdf"
    result = _write_pdf(dest, writer)
    if not result.startswith("已写出"):
        return result
    return f"{result}（已解密）"


TOOLS: tuple[BaseTool, ...] = (
    pdf_info,
    pdf_read,
    pdf_merge,
    pdf_split,
    pdf_generate,
    pdf_encrypt,
    pdf_decrypt,
)


def heuristic(text: str) -> list[str]:
    lowered = text.lower()
    if any(k in lowered for k in ("合并 pdf", "合并两个 pdf", "pdf 合并", "merge pdf", "合成一个 pdf")):
        return ["pdf_merge"]
    if any(k in lowered for k in ("拆分 pdf", "抽取页", "提取第", "拆 pdf", "split pdf", "pdf 拆分")):
        return ["pdf_split"]
    if any(k in lowered for k in ("生成 pdf", "文字转 pdf", "文本转 pdf", "导出 pdf", "制作 pdf", "pdf 生成")):
        return ["pdf_generate"]
    if any(k in lowered for k in ("pdf 加密", "加密 pdf", "加密码", "protect pdf")):
        return ["pdf_encrypt"]
    if any(k in lowered for k in ("pdf 解密", "解密 pdf", "去掉密码", "破解 pdf", "unlock pdf")):
        return ["pdf_decrypt"]
    if any(k in lowered for k in ("pdf 信息", "pdf 页数", "pdf 元数据", "看下这个 pdf", "pdf info")):
        return ["pdf_info"]
    if any(k in lowered for k in ("pdf", "读 pdf", "pdf 内容", "pdf 文本", "提取 pdf", "阅读 pdf")):
        return ["pdf_read"]
    return []
