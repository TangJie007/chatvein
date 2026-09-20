"""Agent 服务：聊天入口（占位实现，后续在此扩展）。"""


def run_chat(message: str) -> dict[str, str | bool]:
    """处理单条用户消息，返回 ``{reply, used_llm}``。

    当前为占位回复；真实 Agent / LLM / 工具链在本模块继续实现。
    """
    text = message.strip()
    return {
        "reply": f"Agent 占位回复：{text}",
        "used_llm": False,
    }
