"""Excel 工作簿生成/编辑工具（mcp-excel）。

实现分层：
- 基于 ``openpyxl`` 原生 OOXML 操作，不依赖 MS Excel / LibreOffice。
- 生成侧：接收结构化工作表描述（name / rows / header），首行加粗 + 冻结。
- 单元格支持富对象：``{"formula": "=SUM(A1:A5)"}`` 或 ``{"value": 42}``；否则按原样写。
- 编辑侧：set_cells / append_rows / add_sheet 三种动作。

约定：
- 路径规则沿用 ``resolve_agent_path``：会话内相对路径直通，会话外绝对路径需人机确认。
- 单文件大小上限 20 MB；单次生成不写图表/条件格式（保持轻量，需要时后续再加）。
"""

from __future__ import annotations

from pathlib import Path
from typing import Annotated, Any

from langchain_core.tools import BaseTool, tool
from pydantic import Field

from mcps.path_access import resolve_agent_path  # pyright: ignore[reportImplicitRelativeImport]

_PATH_XLS = "文件路径。会话内推荐相对路径（例：output/workbook.xlsx）；会话外必须绝对路径并需用户确认。"

_MAX_SHEETS = 200
_MAX_ROWS_PER_SHEET = 100_000
_MAX_SHEET_NAME_LEN = 31


def _resolve(path: str, *, action: str) -> tuple[Path, None] | tuple[None, str]:
    try:
        return resolve_agent_path(path, action=action), None
    except ValueError as exc:
        return None, str(exc)


def _import_openpyxl() -> tuple[Any, Any, None] | tuple[None, None, str]:
    try:
        from openpyxl import Workbook, load_workbook  # type: ignore[import-untyped]
        return Workbook, load_workbook, None
    except ImportError as exc:  # pragma: no cover
        return None, None, f"缺少依赖 openpyxl: {exc}"


def _ensure_parent(path: Path) -> str | None:
    if path.parent and not path.parent.is_dir():
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            return None
        except OSError as exc:
            return f"创建父目录失败: {exc}"
    return None


def _write_cell(cell: Any, value: Any) -> None:
    """把 value 落到 cell。dict 支持 formula / value；其余直接赋值。"""
    if isinstance(value, dict):
        if "formula" in value:
            cell.value = value["formula"]
        elif "value" in value:
            cell.value = value["value"]
        elif "number_format" in value or "bold" in value:
            if "value" not in value and "formula" not in value:
                return
    else:
        cell.value = value


def _safe_sheet_name(name: str, taken: set[str]) -> str:
    clean = (name or "Sheet").strip() or "Sheet"
    clean = clean[:_MAX_SHEET_NAME_LEN]
    if clean not in taken:
        taken.add(clean)
        return clean
    idx = 2
    base = clean[: _MAX_SHEET_NAME_LEN - 4]
    while True:
        candidate = f"{base}_{idx}"[:_MAX_SHEET_NAME_LEN]
        if candidate not in taken:
            taken.add(candidate)
            return candidate
        idx += 1


@tool
def generate_excel_workbook(
    sheets: Annotated[
        list[dict[str, Any]],
        Field(
            description=(
                "工作表列表。每项形如 {\"name\": \"Sheet1\", "
                "\"header\": true, \"rows\": [[\"姓名\", \"年龄\"], [\"张三\", 30]]}。"
                "header=true 时首行加粗并冻结；单元格值可为原语或 {\"formula\": \"=...\"} / {\"value\": ...}。"
            )
        ),
    ],
    output: Annotated[str, Field(description=f"输出 .xlsx 路径。{_PATH_XLS}")],
) -> str:
    """生成 Excel 工作簿（.xlsx）。支持多工作表、公式、首行冻结。"""
    Workbook, _load, err = _import_openpyxl()
    if err:
        return err
    if not sheets:
        return "sheets 不能为空"
    if len(sheets) > _MAX_SHEETS:
        return f"工作表过多（{len(sheets)}，上限 {_MAX_SHEETS}）"
    target, err = _resolve(output, action="generate_excel_workbook")
    if err or target is None:
        return err or "路径无效"
    parent_err = _ensure_parent(target)
    if parent_err:
        return parent_err

    try:
        wb = Workbook()
        wb.remove(wb.active)
        taken: set[str] = set()
        for spec in sheets:
            name = _safe_sheet_name(str(spec.get("name") or "Sheet"), taken)
            ws = wb.create_sheet(title=name)
            use_header = bool(spec.get("header", True))
            rows = spec.get("rows") or []
            if len(rows) > _MAX_ROWS_PER_SHEET:
                return f"工作表 {name} 行数过多（{len(rows)}，上限 {_MAX_ROWS_PER_SHEET}）"
            from openpyxl.styles import Font  # type: ignore[import-untyped]
            for r_idx, row in enumerate(rows):
                if not isinstance(row, (list, tuple)):
                    continue
                for c_idx, value in enumerate(row):
                    cell = ws.cell(row=r_idx + 1, column=c_idx + 1)
                    _write_cell(cell, value)
                    if use_header and r_idx == 0:
                        cell.font = Font(bold=True)
            if use_header and ws.max_row >= 1:
                ws.freeze_panes = "A2"
        wb.save(str(target))
    except Exception as exc:  # noqa: BLE001
        return f"生成 Excel 失败: {exc}"
    return f"已生成 Excel: {target}（{len(sheets)} 个工作表）"


@tool
def edit_excel_workbook(
    path: Annotated[str, Field(description=f"已存在的 .xlsx 文件路径。{_PATH_XLS}")],
    edits: Annotated[
        list[dict[str, Any]],
        Field(
            description=(
                "编辑操作列表，按顺序执行。支持三种 action：\n"
                "1) {\"action\": \"set_cells\", \"sheet\": \"S1\", "
                "\"cells\": [{\"row\": 2, \"column\": 1, \"value\": ...}]}；\n"
                "2) {\"action\": \"append_rows\", \"sheet\": \"S1\", "
                "\"rows\": [[...]]}；\n"
                "3) {\"action\": \"add_sheet\", \"name\": \"S2\", \"rows\": [[...]], "
                "\"header\": true}。"
            )
        ),
    ],
    output: Annotated[
        str | None,
        Field(description="可选输出路径（默认覆盖原文件）。"),
    ] = None,
) -> str:
    """编辑已有 Excel。支持 set_cells / append_rows / add_sheet。未修改内容保留。"""
    Workbook, load_workbook, err = _import_openpyxl()
    if err:
        return err
    if not edits:
        return "edits 不能为空"
    src, err = _resolve(path, action="edit_excel_workbook")
    if err or src is None:
        return err or "路径无效"
    src_path = src
    if not src_path.is_file():
        return f"源文件不存在: {path}"

    dst_path = src_path
    if output:
        dst_path, err = _resolve(output, action="edit_excel_workbook(output)")
        if err or dst_path is None:
            return err or "输出路径无效"
        parent_err = _ensure_parent(dst_path)
        if parent_err:
            return parent_err

    try:
        wb = load_workbook(src_path)
        from openpyxl.styles import Font  # type: ignore[import-untyped]
        applied = 0
        for edit in edits:
            action = str(edit.get("action") or "").strip()
            if action == "set_cells":
                sheet = str(edit.get("sheet") or (wb.sheetnames[0] if wb.sheetnames else ""))
                if sheet not in wb.sheetnames:
                    continue
                ws = wb[sheet]
                for c in edit.get("cells") or []:
                    row_idx = int(c.get("row", 0))
                    col_idx = int(c.get("column", 0))
                    if row_idx <= 0 or col_idx <= 0:
                        continue
                    cell = ws.cell(row=row_idx, column=col_idx)
                    _write_cell(cell, c.get("value"))
                    applied += 1
            elif action == "append_rows":
                sheet = str(edit.get("sheet") or (wb.sheetnames[0] if wb.sheetnames else ""))
                if sheet not in wb.sheetnames:
                    continue
                ws = wb[sheet]
                for row in edit.get("rows") or []:
                    if not isinstance(row, (list, tuple)):
                        continue
                    next_row = ws.max_row + 1
                    for c_idx, value in enumerate(row):
                        _write_cell(ws.cell(row=next_row, column=c_idx + 1), value)
                    applied += 1
            elif action == "add_sheet":
                name = _safe_sheet_name(str(edit.get("name") or "Sheet"), set(wb.sheetnames))
                ws = wb.create_sheet(title=name)
                use_header = bool(edit.get("header", True))
                for r_idx, row in enumerate(edit.get("rows") or []):
                    if not isinstance(row, (list, tuple)):
                        continue
                    for c_idx, value in enumerate(row):
                        cell = ws.cell(row=r_idx + 1, column=c_idx + 1)
                        _write_cell(cell, value)
                        if use_header and r_idx == 0:
                            cell.font = Font(bold=True)
                if use_header and ws.max_row >= 1:
                    ws.freeze_panes = "A2"
                applied += 1
        wb.save(str(dst_path))
    except Exception as exc:  # noqa: BLE001
        return f"编辑 Excel 失败: {exc}"
    return f"已编辑: {dst_path}（执行 {applied}/{len(edits)} 个操作）"


TOOLS: tuple[BaseTool, ...] = (generate_excel_workbook, edit_excel_workbook)


def heuristic(text: str) -> list[str]:
    t = (text or "").lower().replace(" ", "").replace("\u3000", "")
    names: list[str] = []
    if any(k in t for k in ("生成excel", "生成xlsx", "做一份表格", "导出excel", "生成工作簿", "生成电子表格", "做一份excel", "excel表格", "excel文件", "xlsx文件")):
        names.append("generate_excel_workbook")
    if any(k in t for k in ("改excel", "编辑excel", "改xlsx", "编辑xlsx", "修改excel", "修改xlsx", "追加行", "加一列")):
        names.append("edit_excel_workbook")
    return names
