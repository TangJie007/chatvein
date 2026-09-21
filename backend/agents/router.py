"""理解 / 路由：改写用户输入 + 判定难度（主模型 structured output）。"""

from __future__ import annotations

from typing import Any, Literal

from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field

from mcps.registry import heuristic_tool_names  # pyright: ignore[reportImplicitRelativeImport]

from . import llm as llm_mod
from trace import span  # pyright: ignore[reportMissingImports]

Difficulty = Literal["simple", "medium", "hard"]

_SYSTEM = """你是 ChatVein 的理解与路由模块。只做两件事，不回答用户问题本身：

1. rewritten：把用户原话改写成清晰、便于后续工具选择与回答的中文问句。
   - 修正错别字与口语含糊处
   - 补全省略的主语/宾语（不臆造用户没提的新需求）
   - 不改变用户真实意图，不添加原文没有的事实

2. difficulty：评估完成该问题的难度
   - simple：闲聊、寒暄、单句知识问答，通常不需要本地工具或多步推理
   - medium：需要一次或少量本地/联网工具（文件、搜索、计算、只读 SQL、知识库、会话代码沙箱里写并运行一小段 Python）
   - hard：多步、要规划、可能多次工具调用或交叉验证（例如根据报错反复改代码再执行）

只输出结构化字段。"""


class UnderstandDecision(BaseModel):
    rewritten: str = Field(description="改写后的清晰用户意图（中文）")
    difficulty: Difficulty = Field(description="simple | medium | hard")
    reason: str = Field(description="难度判定的简短理由")


def understand(message: str) -> dict[str, Any]:
    """返回 ``{rewritten, difficulty, reason, used_llm}``。全程主模型。"""
    text = (message or "").strip()
    model = llm_mod.get_chat_model(temperature=0)
    if model is None:
        return _offline(text)

    try:
        with span("understand"):
            decision = llm_mod.invoke_structured(
                model,
                UnderstandDecision,
                [
                    SystemMessage(content=_SYSTEM),
                    HumanMessage(content=text or "(空消息)"),
                ],
            )
        rewritten = (decision.rewritten or "").strip() or text
        return {
            "rewritten": rewritten,
            "difficulty": decision.difficulty,
            "reason": decision.reason,
            "used_llm": True,
        }
    except Exception as exc:  # noqa: BLE001
        offline = _offline(text)
        offline["reason"] = f"理解失败({exc}); {offline['reason']}"
        return offline


def _offline(text: str) -> dict[str, Any]:
    """无主模型时：不改写，有工具意图则 medium，否则 simple。"""
    names = heuristic_tool_names(text)
    if names:
        return {
            "rewritten": text,
            "difficulty": "medium",
            "reason": f"离线启发式命中工具: {', '.join(names)}",
            "used_llm": False,
        }
    return {
        "rewritten": text,
        "difficulty": "simple",
        "reason": "离线启发式: 按 simple 处理",
        "used_llm": False,
    }
