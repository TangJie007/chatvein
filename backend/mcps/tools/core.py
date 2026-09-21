"""通用小工具：时间、计算、本机概况。"""

from __future__ import annotations

import ast
import operator
from datetime import datetime, timezone

from langchain_core.tools import BaseTool, tool

import db  # pyright: ignore[reportImplicitRelativeImport]
from models.service import ModelsService  # pyright: ignore[reportImplicitRelativeImport]

_OPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.Pow: operator.pow,
    ast.USub: operator.neg,
    ast.UAdd: operator.pos,
    ast.Mod: operator.mod,
}


def _eval_arith(node: ast.AST) -> float:
    if isinstance(node, ast.Expression):
        return _eval_arith(node.body)
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return float(node.value)
    if isinstance(node, ast.UnaryOp) and type(node.op) in _OPS:
        return float(_OPS[type(node.op)](_eval_arith(node.operand)))  # type: ignore[operator]
    if isinstance(node, ast.BinOp) and type(node.op) in _OPS:
        return float(
            _OPS[type(node.op)](_eval_arith(node.left), _eval_arith(node.right))  # type: ignore[operator]
        )
    raise ValueError("仅支持数字与 + - * / ** % 运算")


@tool
def get_current_time() -> str:
    """返回当前 UTC 与本地时间。询问几点、日期时用。"""
    now_utc = datetime.now(timezone.utc)
    now_local = datetime.now().astimezone()
    return f"utc={now_utc.isoformat()} local={now_local.isoformat()}"


@tool
def calculator(expression: str) -> str:
    """计算纯算术表达式，如 ``(1+2)*3``。"""
    try:
        value = _eval_arith(ast.parse(expression.strip(), mode="eval"))
    except Exception as exc:  # noqa: BLE001
        return f"计算失败: {exc}"
    return str(value)


@tool
def db_stats() -> str:
    """返回本地 SQLite 概况（路径、schema、会话/消息数）。"""
    info = db.info()
    return (
        f"path={info.get('path')} schema=v{info.get('schema_version')} "
        f"conversations={info.get('conversations')} messages={info.get('messages')}"
    )


@tool
def list_configured_models() -> str:
    """列出已配置的 LLM。"""
    models = ModelsService().list_models()
    if not models:
        return "尚未配置任何模型"
    return "\n".join(
        f"- {m.name} ({m.model_id})" + (" [primary]" if m.is_primary else "") for m in models
    )


TOOLS: tuple[BaseTool, ...] = (
    get_current_time,
    calculator,
    db_stats,
    list_configured_models,
)


def heuristic(text: str) -> list[str]:
    names: list[str] = []
    if any(k in text for k in ("时间", "几点", "日期", "time", "date", "now")):
        names.append("get_current_time")
    if any(k in text for k in ("计算", "算一下", "+", "*", "calculate")):
        names.append("calculator")
    if any(k in text for k in ("数据库概况", "db 统计", "sqlite 概况")):
        names.append("db_stats")
    if any(k in text for k in ("模型列表", "有哪些模型", "list models", "llm 配置")):
        names.append("list_configured_models")
    return names
