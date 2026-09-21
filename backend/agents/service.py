"""聊天入口：理解(改写+难度) → 按难度进不同图（全程主模型）。"""

from __future__ import annotations

from typing import Any

from langchain.agents.factory import create_agent
from langchain_core.messages import HumanMessage, SystemMessage

from mcps import resolve_tools, run_tools  # pyright: ignore[reportImplicitRelativeImport]

from . import llm as llm_mod
from . import router, tool_selector

_MEDIUM_SYSTEM = (
    "你是 ChatVein 助手（本机桌面 Agent）。"
    "按需调用已提供的工具：文件在工作区沙箱内操作，联网用 web_search/web_fetch，"
    "查库用 sqlite_*（只读），知识沉淀用 kb_*。"
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
_HARD_SYSTEM = (
    "你是 ChatVein 助手，处理较复杂的本机任务。"
    "先在内部理清步骤，再按需多次调用工具（文件 / 联网 / 知识库 / 只读 SQL / 代码沙箱 / "
    "Bash 或 PowerShell / 浏览器），交叉核对后再用中文总结回答。不要编造工具结果；"
    "写文件前确认路径在工作区内。"
    "用 Python 解决问题时：在当前会话工作区创建虚拟环境，把代码写成 .py，执行，"
    "阅读 stdout 和 stderr，失败就修改后再跑，不要在没有成功执行结果时声称已解决。"
    "操作网页时先 snapshot 再按 ref 交互。"
)


def run_chat(message: str) -> dict[str, Any]:
    """``{reply, used_llm, difficulty, rewritten, ...}``。"""
    text = (message or "").strip()

    understood = router.understand(text)
    rewritten = str(understood.get("rewritten") or text)
    difficulty = str(understood.get("difficulty") or "simple")
    used_llm = bool(understood.get("used_llm"))

    result: dict[str, Any] = {
        "rewritten": rewritten,
        "difficulty": difficulty,
        "route": difficulty,  # 落库 / 兼容旧字段：用难度当 route
        "route_reason": understood.get("reason"),
        "used_llm": used_llm,
    }

    if difficulty == "simple":
        reply, ran_llm = _direct_reply(rewritten)
        result["reply"] = reply
        result["used_llm"] = used_llm or ran_llm
        return result

    # medium / hard：选型缩集 → 一个 Tool-calling Agent（hard 用更强 system）
    planned = tool_selector.select_tools(rewritten)
    names = list(planned.get("selected_tools") or [])
    result["selected_tools"] = names
    result["tool_plan_reason"] = planned.get("tool_plan_reason")
    used_llm = used_llm or bool(planned.get("used_llm"))

    system = _HARD_SYSTEM if difficulty == "hard" else _MEDIUM_SYSTEM
    reply, ran_llm = _tool_calling_reply(rewritten, names, system_prompt=system)
    result["reply"] = reply
    result["used_llm"] = used_llm or ran_llm
    return result


def _direct_reply(text: str) -> tuple[str, bool]:
    model = llm_mod.get_chat_model()
    if model is None:
        return (f"（离线）{text}" if text else "（离线）未配置 LLM。"), False
    try:
        msg = model.invoke(
            [
                SystemMessage(content="你是 ChatVein 助手，用中文简洁回答。"),
                HumanMessage(content=text or "你好"),
            ]
        )
        content = msg.content if isinstance(msg.content, str) else str(msg.content)
        return content, True
    except Exception as exc:  # noqa: BLE001
        return f"直接回答失败: {exc}", False


def _tool_calling_reply(
    text: str,
    names: list[str],
    *,
    system_prompt: str,
) -> tuple[str, bool]:
    tools = resolve_tools(names)
    model = llm_mod.get_chat_model()
    if model is None:
        return run_tools(text, names), False
    try:
        agent = create_agent(model, tools, system_prompt=system_prompt)
        out = agent.invoke({"messages": [HumanMessage(content=text or "请执行工具")]})
        for msg in reversed(out.get("messages") or []):
            content = getattr(msg, "content", None)
            if isinstance(content, str) and content.strip():
                return content, True
        return "工具调用完成，但无文本回复。", True
    except Exception as exc:  # noqa: BLE001
        return f"工具调用失败({exc})\n{run_tools(text, names)}", False
