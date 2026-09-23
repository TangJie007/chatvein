"""PowerPoint 生成工具（mcp-pptx）。

实现分层：
- 基于 ``python-pptx`` 原生 OOXML 操作，不依赖 MS PowerPoint / LibreOffice。
- 生成侧：接收 slides 结构化描述（title / body / bullet），落为 .pptx。
- 主题：内置 4 套（neutral / mckinsey / deloitte / ir），仅影响主色/字体/边距。

约定：
- 路径规则沿用 ``resolve_agent_path``：会话内相对路径直通，会话外绝对路径需人机确认。
- 尺寸：默认 16:9（13.333 x 7.5 英寸）。
- 禁用项：LibreOffice 渲染截图 / PII scrubbing 均不提供。
"""

from __future__ import annotations

from pathlib import Path
from typing import Annotated, Any, Literal

from langchain_core.tools import BaseTool, tool
from pydantic import Field

from mcps.path_access import resolve_agent_path  # pyright: ignore[reportImplicitRelativeImport]

_PATH_PPT = "文件路径。会话内推荐相对路径（例：output/deck.pptx）；会话外必须绝对路径并需用户确认。"

THEMES = ("neutral", "mckinsey", "deloitte", "ir")

_THEME_COLORS = {
    "neutral": {"accent": "1F4E79", "bg": "FFFFFF", "text": "333333", "font": "Calibri"},
    "mckinsey": {"accent": "E4002B", "bg": "FFFFFF", "text": "000000", "font": "Calibri"},
    "deloitte": {"accent": "86BC25", "bg": "FFFFFF", "text": "0F1B2C", "font": "Arial"},
    "ir": {"accent": "1B3B6F", "bg": "FFFFFF", "text": "222222", "font": "Microsoft YaHei"},
}


def _resolve(path: str, *, action: str) -> tuple[Path, None] | tuple[None, str]:
    try:
        return resolve_agent_path(path, action=action), None
    except ValueError as exc:
        return None, str(exc)


def _import_pptx() -> tuple[Any, Any, Any, Any, None] | tuple[None, None, None, None, str]:
    """返回 (Presentation, Inches, Pt, RGBColor, error)。"""
    try:
        from pptx import Presentation  # type: ignore[import-untyped]
        from pptx.util import Inches, Pt  # type: ignore[import-untyped]
        from pptx.dml.color import RGBColor  # type: ignore[import-untyped]
        return Presentation, Inches, Pt, RGBColor, None
    except ImportError as exc:  # pragma: no cover
        return None, None, None, None, f"缺少依赖 python-pptx: {exc}"


def _ensure_parent(path: Path) -> str | None:
    if path.parent and not path.parent.is_dir():
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            return None
        except OSError as exc:
            return f"创建父目录失败: {exc}"
    return None


def _hex_color(hex_str: str, RGBColor: Any) -> Any:
    return RGBColor.from_string(hex_str)


def _fill_bg(slide: Any, color_hex: str, Inches: Any, RGBColor: Any) -> None:
    """把幻灯片背景填成指定色。失败静默（不影响整体生成）。"""
    try:
        background = slide.background
        fill = background.fill
        fill.solid()
        fill.fore_color.rgb = RGBColor.from_string(color_hex)
    except Exception:  # noqa: BLE001
        pass


def _add_textbox(
    slide: Any,
    *,
    left: float,
    top: float,
    width: float,
    height: float,
    text: str,
    font_size_pt: int,
    bold: bool,
    color_hex: str,
    font_name: str,
    Inches: Any,
    Pt: Any,
    RGBColor: Any,
) -> None:
    shape = slide.shapes.add_textbox(Inches(left), Inches(top), Inches(width), Inches(height))
    tf = shape.text_frame
    tf.word_wrap = True
    lines = (text or "").split("\n")
    for idx, line in enumerate(lines):
        p = tf.paragraphs[0] if idx == 0 else tf.add_paragraph()
        run = p.add_run()
        run.text = line
        run.font.size = Pt(font_size_pt)
        run.font.bold = bold
        run.font.name = font_name
        try:
            run.font.color.rgb = RGBColor.from_string(color_hex)
        except Exception:  # noqa: BLE001
            pass


@tool
def generate_powerpoint_document(
    slides: Annotated[
        list[dict[str, Any]],
        Field(
            description=(
                "幻灯片列表，按顺序生成。每项形如 "
                "{\"type\": \"title\"|\"section\"|\"bullet\"|\"section-title\", "
                "\"title\": \"标题\", \"subtitle\": \"可选副标题\", \"bullets\": [\"要点1\", ...]}"
            )
        ),
    ],
    output: Annotated[str, Field(description=f"输出 .pptx 路径。{_PATH_PPT}")],
    theme: Annotated[
        Literal["neutral", "mckinsey", "deloitte", "ir"],
        Field(description="主题：neutral（通用）/ mckinsey（红黑）/ deloitte（绿）/ ir（蓝）"),
    ] = "neutral",
) -> str:
    """根据结构化描述生成 PPT 演示文稿。支持标题页/章节页/要点页三种常见版式。"""
    result = _import_pptx()
    if result[4] is not None:
        return str(result[4])
    Presentation, Inches, Pt, RGBColor = result[0], result[1], result[2], result[3]

    if not slides:
        return "slides 不能为空"
    target, err = _resolve(output, action="generate_powerpoint_document")
    if err or target is None:
        return err or "路径无效"
    parent_err = _ensure_parent(target)
    if parent_err:
        return parent_err

    if theme not in THEMES:
        return f"未知主题: {theme}（可选 {', '.join(THEMES)}）"
    theme_cfg = _THEME_COLORS[theme]

    try:
        prs = Presentation()
        prs.slide_width = Inches(13.333)
        prs.slide_height = Inches(7.5)
        blank_layout = prs.slide_layouts[6]  # blank

        for slide_spec in slides:
            kind = str(slide_spec.get("type") or "bullet").lower()
            title = str(slide_spec.get("title") or "").strip()
            subtitle = str(slide_spec.get("subtitle") or "").strip()
            bullets = list(slide_spec.get("bullets") or [])

            slide = prs.slides.add_slide(blank_layout)
            _fill_bg(slide, theme_cfg["bg"], Inches, RGBColor)

            # 顶部装饰条
            _add_textbox(
                slide,
                left=0.7, top=0.4, width=0.1, height=0.1,
                text=" ", font_size_pt=12, bold=False,
                color_hex=theme_cfg["accent"], font_name=theme_cfg["font"],
                Inches=Inches, Pt=Pt, RGBColor=RGBColor,
            )

            if kind == "title":
                _add_textbox(
                    slide, left=1.0, top=2.8, width=11.3, height=1.6,
                    text=title or "Untitled", font_size_pt=44, bold=True,
                    color_hex=theme_cfg["accent"], font_name=theme_cfg["font"],
                    Inches=Inches, Pt=Pt, RGBColor=RGBColor,
                )
                if subtitle:
                    _add_textbox(
                        slide, left=1.0, top=4.6, width=11.3, height=1.0,
                        text=subtitle, font_size_pt=24, bold=False,
                        color_hex=theme_cfg["text"], font_name=theme_cfg["font"],
                        Inches=Inches, Pt=Pt, RGBColor=RGBColor,
                    )
            elif kind == "section":
                _add_textbox(
                    slide, left=1.0, top=3.0, width=11.3, height=1.4,
                    text=title or "Section", font_size_pt=40, bold=True,
                    color_hex=theme_cfg["accent"], font_name=theme_cfg["font"],
                    Inches=Inches, Pt=Pt, RGBColor=RGBColor,
                )
            else:
                # bullet 页
                _add_textbox(
                    slide, left=0.7, top=0.5, width=12.0, height=1.0,
                    text=title or "Untitled", font_size_pt=30, bold=True,
                    color_hex=theme_cfg["accent"], font_name=theme_cfg["font"],
                    Inches=Inches, Pt=Pt, RGBColor=RGBColor,
                )
                if bullets:
                    body_lines = [f"• {b}" for b in bullets if str(b).strip()]
                    if body_lines:
                        _add_textbox(
                            slide, left=1.0, top=2.0, width=11.5, height=5.0,
                            text="\n".join(body_lines), font_size_pt=20, bold=False,
                            color_hex=theme_cfg["text"], font_name=theme_cfg["font"],
                            Inches=Inches, Pt=Pt, RGBColor=RGBColor,
                        )

        prs.save(str(target))
    except Exception as exc:  # noqa: BLE001
        return f"生成 PPT 失败: {exc}"
    return f"已生成 PPT: {target}（{len(slides)} 页，主题 {theme}）"


@tool
def edit_powerpoint_document(
    path: Annotated[str, Field(description=f"已存在的 .pptx 文件路径。{_PATH_PPT}")],
    replacements: Annotated[
        list[dict[str, str]],
        Field(
            description=(
                "替换列表，按顺序执行。每项形如 {\"find\": \"原文\", \"replace\": \"新文\"}。"
                "find 精确匹配，跨所有幻灯片的文本框遍历。"
            )
        ),
    ],
    output: Annotated[
        str | None,
        Field(description="可选输出路径（默认覆盖原文件）。"),
    ] = None,
) -> str:
    """按精确替换编辑已有 PPT。未触及内容保持原样（无损）。"""
    result = _import_pptx()
    if result[4] is not None:
        return str(result[4])
    Presentation = result[0]

    if not replacements:
        return "replacements 不能为空"
    src, err = _resolve(path, action="edit_powerpoint_document")
    if err or src is None:
        return err or "路径无效"
    src_path = src
    if not src_path.is_file():
        return f"源文件不存在: {path}"

    dst_path = src_path
    if output:
        dst_path, err = _resolve(output, action="edit_powerpoint_document(output)")
        if err or dst_path is None:
            return err or "输出路径无效"
        parent_err = _ensure_parent(dst_path)
        if parent_err:
            return parent_err

    try:
        prs = Presentation(str(src_path))
        applied = 0
        for item in replacements:
            find = str(item.get("find") or "")
            replace = str(item.get("replace") or "")
            if not find:
                continue
            hit = False
            for slide in prs.slides:
                for shape in slide.shapes:
                    if not hasattr(shape, "text_frame"):
                        continue
                    tf = shape.text_frame
                    for para in tf.paragraphs:
                        for run in para.runs:
                            if find in run.text:
                                run.text = run.text.replace(find, replace)
                                hit = True
            if hit:
                applied += 1
        prs.save(str(dst_path))
    except Exception as exc:  # noqa: BLE001
        return f"编辑 PPT 失败: {exc}"
    return f"已编辑: {dst_path}（应用 {applied}/{len(replacements)} 处替换）"


TOOLS: tuple[BaseTool, ...] = (generate_powerpoint_document, edit_powerpoint_document)


def heuristic(text: str) -> list[str]:
    t = (text or "").lower().replace(" ", "").replace("\u3000", "")
    names: list[str] = []
    if any(k in t for k in ("生成ppt", "生成pptx", "做一份ppt", "生成幻灯片", "生成演示", "做演示", "演示文稿", "生成slide", "做一份pptx", "做幻灯片")):
        names.append("generate_powerpoint_document")
    if any(k in t for k in ("改ppt", "编辑ppt", "改pptx", "编辑pptx", "修改ppt", "修改pptx")):
        names.append("edit_powerpoint_document")
    return names
