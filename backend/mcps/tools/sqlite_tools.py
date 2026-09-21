"""SQLite 工具 — 只读查询本机 ChatVein 库（及可选附加库路径需在工作区外拒绝）。"""

from __future__ import annotations

import re
import sqlite3
from typing import Any

from langchain_core.tools import BaseTool, tool

import db  # pyright: ignore[reportImplicitRelativeImport]

_FORBIDDEN = re.compile(
    r"\b(insert|update|delete|drop|alter|attach|detach|pragma|vacuum|replace|create)\b",
    re.I,
)
_MAX_ROWS = 50


def _connect_ro() -> sqlite3.Connection:
    path = db.resolve_db_path()
    # URI mode=ro：只读打开，避免 Agent 误改业务库
    uri = f"file:{path.as_posix()}?mode=ro"
    conn = sqlite3.connect(uri, uri=True)
    conn.row_factory = sqlite3.Row
    return conn


@tool
def sqlite_tables() -> str:
    """列出本机 ChatVein SQLite 中的用户表。"""
    try:
        with _connect_ro() as conn:
            rows = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
            ).fetchall()
    except Exception as exc:  # noqa: BLE001
        return f"列举失败: {exc}"
    if not rows:
        return "(无表)"
    return "\n".join(f"- {r['name']}" for r in rows)


@tool
def sqlite_schema(table: str) -> str:
    """查看指定表的 CREATE SQL / 列信息。"""
    name = (table or "").strip()
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name):
        return "表名非法"
    try:
        with _connect_ro() as conn:
            row = conn.execute(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name=?",
                (name,),
            ).fetchone()
            cols = conn.execute(f"PRAGMA table_info({name})").fetchall()  # noqa: S608
    except Exception as exc:  # noqa: BLE001
        return f"读取 schema 失败: {exc}"
    if row is None:
        return f"表不存在: {name}"
    lines = [str(row["sql"] or ""), "columns:"]
    for c in cols:
        lines.append(f"- {c['name']} {c['type']} {'NOT NULL' if c['notnull'] else ''}")
    return "\n".join(lines)


@tool
def sqlite_query(sql: str) -> str:
    """对 ChatVein 库执行只读 SELECT（禁止写操作）。最多返回 50 行。"""
    statement = (sql or "").strip().rstrip(";")
    if not statement:
        return "sql 不能为空"
    if _FORBIDDEN.search(statement) or not re.match(r"(?is)^\s*select\b", statement):
        return "仅允许 SELECT 查询"
    try:
        with _connect_ro() as conn:
            cur = conn.execute(statement)
            rows = cur.fetchmany(_MAX_ROWS + 1)
            colnames = [d[0] for d in (cur.description or [])]
    except Exception as exc:  # noqa: BLE001
        return f"查询失败: {exc}"

    truncated = len(rows) > _MAX_ROWS
    rows = rows[:_MAX_ROWS]
    if not rows:
        return "（0 行）"
    lines = ["\t".join(colnames)]
    for r in rows:
        vals = [ _fmt(r[c]) for c in colnames ]
        lines.append("\t".join(vals))
    if truncated:
        lines.append("…(已截断)")
    return "\n".join(lines)


def _fmt(value: Any) -> str:
    if value is None:
        return "NULL"
    text = str(value).replace("\t", " ").replace("\n", " ")
    return text[:120]


TOOLS: tuple[BaseTool, ...] = (sqlite_tables, sqlite_schema, sqlite_query)


def heuristic(text: str) -> list[str]:
    names: list[str] = []
    if any(k in text for k in ("有哪些表", "list tables", "sqlite 表")):
        names.append("sqlite_tables")
    if any(k in text for k in ("表结构", "schema", "列信息")):
        names.append("sqlite_schema")
    if any(k in text for k in ("select ", "sql 查询", "查库", "执行 sql", "sqlite 查询")):
        names.append("sqlite_query")
    return names
