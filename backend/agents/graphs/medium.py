"""medium 图：tool_selector → ReAct（agent ⇄ tools）循环。"""

from __future__ import annotations

from typing import Any

from langchain.agents import create_agent
from langchain_core.messages import HumanMessage
from langgraph.graph import END, START, StateGraph

from mcps import resolve_tools, run_tools  # pyright: ignore[reportImplicitRelativeImport]

from .. import llm as llm_mod
from .. import tool_selector

from .common import last_text
from .state import ChatState

_MEDIUM_SYSTEM = (
    "你是 ChatVein 助手（本机桌面 Agent）。"
    "按需调用已提供的工具：文件在工作区沙箱内操作，联网用 web_search/web_fetch，"
    "查库用 sqlite_*（只读），知识沉淀用 kb_*，识图用 ocr_image（先 OCR.space，失败会自动走沙箱脚本）。"
    "需要跑 Python 时只用代码沙箱：sandbox_create_venv、sandbox_write_file、"
    "sandbox_run_python（缺包再用 sandbox_pip_install）。这些工具只作用于当前会话目录。"
    "Git Bash 用 bash_run（本机已安装时才有）；Windows 上还可用 powershell_run。"
    "两者都只在当前会话目录。只读命令会直接执行；"
    "会改文件的命令要等用户确认；被拒绝的命令不要换一种写法绕过。"
    "浏览器用 browser_*（本机已安装 Playwright 浏览器时才有）：先 browser_navigate / "
    "browser_snapshot，再按快照里的 ref（如 e5）调用 browser_click / browser_type 等；"
    "不要靠截图像素点选。"
    "根据 stdout/stderr 改代码再执行，直到问题解决或明确说明卡在哪里。"
    "简洁用中文给出结果，并注明关键来源路径或链接。"
)

# medium：少量工具调用即可；限制图递归，避免空转
_RECURSION_LIMIT = 12


def build_react_graph(model: Any, tools: list[Any], *, system_prompt: str, name: str):
    """用 ``create_agent`` 得到 ReAct 编译图（model ↔ tools 直到无 tool_calls）。"""
    return create_agent(
        model,
        tools,
        system_prompt=system_prompt,
        name=name,
    )


def build_medium_graph(*, system_prompt: str = _MEDIUM_SYSTEM, name: str = "medium_react"):
    """选型 → ReAct 的 medium 子图。"""

    def select_tools_node(state: ChatState) -> dict[str, Any]:
        planned = tool_selector.select_tools(state.get("rewritten") or state.get("message") or "")
        used = bool(state.get("used_llm")) or bool(planned.get("used_llm"))
        return {
            "selected_tools": list(planned.get("selected_tools") or []),
            "tool_plan_reason": str(planned.get("tool_plan_reason") or ""),
            "used_llm": used,
        }

    def react_node(state: ChatState) -> dict[str, Any]:
        text = (state.get("rewritten") or state.get("message") or "").strip()
        names = list(state.get("selected_tools") or [])
        tools = resolve_tools(names)
        model = llm_mod.get_chat_model()
        if model is None:
            return {
                "reply": run_tools(text, names),
                "used_llm": False,
            }
        try:
            agent = build_react_graph(
                model,
                tools,
                system_prompt=system_prompt,
                name=name,
            )
            out = agent.invoke(
                {"messages": [HumanMessage(content=text or "请执行工具")]},
                config={"recursion_limit": _RECURSION_LIMIT},
            )
            reply = last_text(out.get("messages")) or "工具调用完成，但无文本回复。"
            return {
                "reply": reply,
                "used_llm": True,
            }
        except Exception as exc:  # noqa: BLE001
            return {
                "reply": f"工具调用失败({exc})\n{run_tools(text, names)}",
                "used_llm": False,
            }

    graph = StateGraph(ChatState)
    graph.add_node("select_tools", select_tools_node)
    graph.add_node("react", react_node)
    graph.add_edge(START, "select_tools")
    graph.add_edge("select_tools", "react")
    graph.add_edge("react", END)
    return graph.compile(name="medium_pipeline")


def run_medium(
    rewritten: str,
    *,
    used_llm: bool = False,
    system_prompt: str = _MEDIUM_SYSTEM,
    name: str = "medium_react",
) -> dict[str, Any]:
    """跑 medium 子图，返回 reply / selected_tools / used_llm 等。"""
    out = build_medium_graph(system_prompt=system_prompt, name=name).invoke(
        {
            "message": rewritten,
            "rewritten": rewritten,
            "used_llm": used_llm,
        }
    )
    return {
        "reply": str(out.get("reply") or ""),
        "selected_tools": list(out.get("selected_tools") or []),
        "tool_plan_reason": out.get("tool_plan_reason"),
        "used_llm": bool(used_llm or out.get("used_llm")),
    }


MEDIUM_SYSTEM = _MEDIUM_SYSTEM
