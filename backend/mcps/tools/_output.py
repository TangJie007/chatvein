"""执行类工具的共用输出处理：Bash / PowerShell / 代码沙箱三处原本各抄一份。"""

MAX_OUTPUT = 12_000


def clip(text: str | bytes | None) -> str:
    """统一成 str 并截断，超长时追加显式提示，避免把整份日志倒进聊天框。"""
    if text is None:
        return ""
    value = text.decode("utf-8", errors="replace") if isinstance(text, bytes) else text
    if len(value) <= MAX_OUTPUT:
        return value
    return value[:MAX_OUTPUT] + "\n…(输出已截断)"
