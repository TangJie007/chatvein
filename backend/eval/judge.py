"""可选 LLM 评分：回答好不好，规则断言说不清的那部分交给模型。

默认关闭（``--judge`` 才启用）。评分只用于观察趋势，不参与硬门槛：
硬门槛永远是 ``cases.check_rules``，否则模型一抖动整套评测就失去意义。
"""

from __future__ import annotations

import json
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field

from agents.llm import get_chat_model, invoke_structured  # pyright: ignore[reportImplicitRelativeImport]

_SYSTEM = """你是严格的对话评测员。按给定维度给 Agent 的实际回复打分（0-5 整数）：
- relevance：是否回答了用户真正的问题
- correctness：事实/结论是否正确，有无编造
- tool_use：工具选择与参数是否合理（用错工具或该用没用都给低分）
- format：是否按要求的结构/长度/语言输出

只输出结构化字段，不要寒暄。理由一句话，指出最关键的扣分点。"""


class JudgeScores(BaseModel):
    """四个维度各 0-5；总分由调用方取均值。"""

    relevance: int = Field(ge=0, le=5, description="是否回答了用户真正的问题")
    correctness: int = Field(ge=0, le=5, description="事实与结论是否正确，有无编造")
    tool_use: int = Field(ge=0, le=5, description="工具选择与参数是否合理")
    format: int = Field(ge=0, le=5, description="是否满足要求的结构 / 长度 / 语言")
    reason: str = Field(default="", description="一句话说明最关键的问题")


class JudgeUnavailable(RuntimeError):
    """评分模型不可用（没配模型、没填 api_key）。"""


def resolve_model(model_id: str | None) -> Any:
    """评分模型：显式传入优先，缺省由 runner 传 agent 自己的模型。"""
    model = get_chat_model(role={"model_id": model_id} if model_id else None, temperature=0.0, streaming=False)
    if model is None:
        raise JudgeUnavailable(f"评分模型不可用：{model_id or '（未指定）'}")
    return model


def _tool_lines(result: dict[str, Any]) -> list[str]:
    lines: list[str] = []
    for item in result.get("tool_trace") or []:
        if not isinstance(item, dict):
            continue
        name = str(item.get("tool_name") or "unknown")
        status = str(item.get("status") or "ok")
        lines.append(f"- {name}（{status}）")
    return lines or ["（本轮没有调用工具）"]


def _prompt(case: dict[str, Any], result: dict[str, Any]) -> str:
    parts = [
        f"# 用户请求\n{case.get('message') or ''}",
    ]
    rubric = str(case.get("rubric") or "").strip()
    if rubric:
        parts.append(f"# 期望（评分重点）\n{rubric}")
    parts.append("# Agent 实际调用\n" + "\n".join(_tool_lines(result)))
    parts.append(f"# Agent 回复\n{result.get('reply') or '（空）'}")
    return "\n\n".join(parts)


def judge_case(case: dict[str, Any], result: dict[str, Any], *, model: Any) -> dict[str, Any]:
    """返回各维度分数与均值；模型输出不合法时抛异常，由 runner 记为个案错误。"""
    raw = invoke_structured(
        model,
        JudgeScores,
        [SystemMessage(content=_SYSTEM), HumanMessage(content=_prompt(case, result))],
    )
    scores = raw if isinstance(raw, JudgeScores) else JudgeScores.model_validate(raw)
    dims = [scores.relevance, scores.correctness, scores.tool_use, scores.format]
    return {
        "score": round(sum(dims) / len(dims), 2),
        "relevance": scores.relevance,
        "correctness": scores.correctness,
        "tool_use": scores.tool_use,
        "format": scores.format,
        "reason": scores.reason.strip(),
        "raw": json.loads(scores.model_dump_json()),
    }
