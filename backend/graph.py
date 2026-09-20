"""ChatVein 的 LangGraph 工作流。

设计原则：provider 无关、可离线运行。
- 若环境中配置了 OPENAI_API_KEY（可选 OPENAI_BASE_URL / OPENAI_MODEL），
  `generate` 节点会调用真实 LLM。
- 否则自动降级到确定性节点，保证开发期无需任何 key 也能跑起来。

图结构（展示 LangGraph 的条件分支能力）：
    START
      │
   classify  ──路由──►  llm  (真实/降级 LLM 回复)
      │                 echo (非问句 → 回声)
   (conditional)
      ▼
     END
"""
from __future__ import annotations

import os
from typing import Literal, TypedDict

from langgraph.graph import END, START, StateGraph

# 模块级缓存 LLM 实例，避免每次请求重建。无 key 时为 None → 走降级。
_LLM = None
_LLM_READY = False


class ChatState(TypedDict, total=False):
    """LangGraph 在节点间传递的状态。"""

    input: str
    reply: str
    route: Literal["llm", "echo"]
    used_llm: bool


def _get_llm():
    """惰性构造 LLM，仅在首次调用且环境存在 key 时构建。"""
    global _LLM, _LLM_READY
    if _LLM_READY:
        return _LLM
    _LLM_READY = True

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return None
    try:
        from langchain_openai import ChatOpenAI
    except ImportError:
        return None

    _LLM = ChatOpenAI(
        model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
        api_key=api_key,
        base_url=os.getenv("OPENAI_BASE_URL"),  # 兼容代理 / 第三方 OpenAI 兼容服务
        temperature=0.7,
    )
    return _LLM


def classify(state: ChatState) -> ChatState:
    """根据输入是否为问句决定路由方向。"""
    text = (state.get("input") or "").strip()
    is_question = text.endswith("?") or text.endswith("？") or text.endswith("吗")
    return {"route": "llm" if is_question else "echo"}


def route(state: ChatState) -> str:
    """条件边：把状态里的 route 标签映射到下一个节点。"""
    return state.get("route", "echo")


def echo_node(state: ChatState) -> ChatState:
    """非问句：原样回声（也可替换为检索/工具调用等逻辑）。"""
    return {"reply": f"回声：{state.get('input', '')}"}


def generate(state: ChatState) -> ChatState:
    """问句：优先 LLM，失败或缺失时降级。"""
    text = (state.get("input") or "").strip()
    llm = _get_llm()

    if llm is not None:
        try:
            result = llm.invoke([{"role": "user", "content": text}])
            return {"reply": result.content, "used_llm": True}
        except Exception as exc:  # 调用失败不要中断整个请求
            return {
                "reply": f"[LLM 调用失败，已降级] {exc}\n{text}",
                "used_llm": False,
            }

    # 离线降级：一个可运行的占位回复，证明 LangGraph 图已跑通。
    return {"reply": f"LangGraph 已处理（离线模式）：{text}", "used_llm": False}


def build_chat_graph():
    """构建并编译聊天图，返回可 `.invoke(state)` 的 compiled graph。"""
    builder = StateGraph(ChatState)
    builder.add_node("classify", classify)
    builder.add_node("llm", generate)
    builder.add_node("echo", echo_node)

    builder.add_edge(START, "classify")
    builder.add_conditional_edges("classify", route, {"llm": "llm", "echo": "echo"})
    builder.add_edge("llm", END)
    builder.add_edge("echo", END)

    return builder.compile()


def run_chat(message: str) -> dict:
    """对单条消息跑一遍图，返回 {reply, used_llm}。"""
    graph = build_chat_graph()
    result = graph.invoke({"input": message})
    return {"reply": result.get("reply", ""), "used_llm": result.get("used_llm", False)}
