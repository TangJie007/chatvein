"""从 Agent 输出消息抽取工具调用轨迹。"""

from __future__ import annotations

from typing import Any


def extract_tool_trace(messages: list[Any] | None) -> list[dict[str, Any]]:
    """配对 AIMessage.tool_calls 与 ToolMessage，供落 ``logs/session.sqlite``。"""
    pending: dict[str, dict[str, Any]] = {}
    ordered: list[dict[str, Any]] = []

    for msg in messages or []:
        tool_calls = getattr(msg, "tool_calls", None) or []
        for call in tool_calls:
            if isinstance(call, dict):
                cid = str(call.get("id") or "")
                name = str(call.get("name") or "")
                args = call.get("args")
            else:
                cid = str(getattr(call, "id", "") or "")
                name = str(getattr(call, "name", "") or "")
                args = getattr(call, "args", None)
            item = {
                "tool_name": name or "unknown",
                "tool_call_id": cid or None,
                "arguments": args,
                "result_text": "",
                "status": "pending",
            }
            ordered.append(item)
            if cid:
                pending[cid] = item

        msg_type = getattr(msg, "type", None) or msg.__class__.__name__
        if msg_type in ("tool", "ToolMessage") or msg.__class__.__name__ == "ToolMessage":
            cid = str(getattr(msg, "tool_call_id", "") or "")
            name = str(getattr(msg, "name", "") or "")
            content = getattr(msg, "content", "")
            text = content if isinstance(content, str) else str(content)
            if cid and cid in pending:
                pending[cid]["result_text"] = text
                pending[cid]["status"] = "ok"
                if name:
                    pending[cid]["tool_name"] = name
            else:
                ordered.append(
                    {
                        "tool_name": name or "unknown",
                        "tool_call_id": cid or None,
                        "arguments": None,
                        "result_text": text,
                        "status": "ok",
                    }
                )

    for item in ordered:
        if item.get("status") == "pending":
            item["status"] = "ok"
    return ordered
