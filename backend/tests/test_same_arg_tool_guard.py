"""同参同工具去重，防止 ReAct 空转。"""

from __future__ import annotations

from types import SimpleNamespace

from langchain_core.messages import ToolMessage

from agents.graphs.common import same_arg_tool_guard, tool_call_fingerprint


def test_fingerprint_stable_for_same_args() -> None:
    a = tool_call_fingerprint("web_search", {"query": "天气", "max_results": 5})
    b = tool_call_fingerprint("web_search", {"max_results": 5, "query": "天气"})
    c = tool_call_fingerprint("web_search", {"query": "气温", "max_results": 5})
    assert a == b
    assert a != c


def test_same_arg_tool_guard_blocks_duplicate() -> None:
    guard = same_arg_tool_guard()
    # wrap_tool_call returns middleware; invoke wrap_tool_call hook directly
    hook = guard.wrap_tool_call
    assert hook is not None

    calls: list[str] = []

    def handler(request):  # noqa: ANN001
        calls.append("run")
        return ToolMessage(content="ok", tool_call_id=request.tool_call["id"])

    req1 = SimpleNamespace(
        tool_call={"name": "web_search", "args": {"query": "天气"}, "id": "c1"}
    )
    req2 = SimpleNamespace(
        tool_call={"name": "web_search", "args": {"query": "天气"}, "id": "c2"}
    )
    req3 = SimpleNamespace(
        tool_call={"name": "web_search", "args": {"query": "北京天气"}, "id": "c3"}
    )

    first = hook(req1, handler)
    second = hook(req2, handler)
    third = hook(req3, handler)

    assert isinstance(first, ToolMessage) and first.content == "ok"
    assert isinstance(second, ToolMessage) and "已拒绝重复调用" in second.content
    assert second.status == "error"
    assert isinstance(third, ToolMessage) and third.content == "ok"
    assert calls == ["run", "run"]
