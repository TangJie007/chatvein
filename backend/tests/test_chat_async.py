"""/api/chat 异步化：断连时不落库，正常连接时按原逻辑落库。"""

from __future__ import annotations

import asyncio
from pathlib import Path
from unittest.mock import MagicMock, patch

from starlette.requests import Request

import main
from main import ChatRequest

_DUMMY_RESULT = {
    "reply": "ok",
    "difficulty": "simple",
    "used_llm": True,
    "tool_trace": [],
    "route_reason": "r",
    "tool_plan_reason": None,
    "selected_tools": [],
    "rewritten": None,
}


def _make_request(disconnected: bool) -> Request:
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": "/api/chat",
        "raw_path": b"/api/chat",
        "query_string": b"",
        "root_path": "",
        "headers": [],
        "client": ("testclient", 50000),
        "server": ("testserver", 80),
    }
    request = Request(scope)

    async def _is_disconnected() -> bool:
        return disconnected

    request.is_disconnected = _is_disconnected  # type: ignore[method-assign]
    return request


def _patch_deps():
    """把 _chat_turn 依赖的耗时链路全部打桩，只留落库行为可观测。"""
    role = {"id": "role-1", "model_id": "m-1", "memory": 12}
    prepared = {"id": "c-1", "title": "t", "workspace_dir": "ws-dir"}

    save_exchange = MagicMock(return_value=("c-1", "user-msg", "assistant-msg"))
    sandbox = MagicMock()
    recording = MagicMock()
    recording.return_value.__enter__.return_value = None
    recording.return_value.__exit__.return_value = None

    patches = [
        patch.object(main.conversations_service, "open_for_chat", return_value=prepared),
        patch.object(
            main.conversations_service, "set_conversation_skills", return_value=None
        ),
        patch.object(main.conversations_service, "short_term_memory", return_value=[]),
        patch.object(
            main.conversations_service, "get_conversation_skills", return_value=[]
        ),
        patch.object(
            main.conversations_service,
            "workspace_root_for",
            return_value="ws-root",
        ),
        patch.object(main.conversations_service, "save_exchange", save_exchange),
        patch.object(main.conversations_service, "workspace_insight", return_value={}),
        patch.object(main.chats_service, "register_group_members", return_value=None),
        patch.object(
            main.chats_service,
            "assemble_team",
            side_effect=lambda r, gm, **kw: r,
        ),
        patch("roles.service.RolesService.resolve_for_chat", return_value=role),
        patch("skills.service.skill_prompt_blocks", return_value=""),
        patch.object(main, "session_db_path", return_value=Path("C:/tmp/x.db")),
        patch.object(main, "run_chat", return_value=dict(_DUMMY_RESULT)),
        patch.object(main, "trace_service", MagicMock(recording=recording)),
        patch.object(main, "use_conversation_sandbox", sandbox),
        patch.object(main, "_usage_callback", None),
    ]
    return patches, {"save_exchange": save_exchange}


def _run_turn(disconnected: bool) -> tuple[dict[str, object], dict[str, MagicMock]]:
    req = ChatRequest(conversation_id="c-1", message="hi")
    request = _make_request(disconnected)
    patches, mocks = _patch_deps()
    with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[
        6
    ], patches[7], patches[8], patches[9], patches[10], patches[11], patches[12], patches[
        13
    ], patches[14], patches[15]:
        return asyncio.run(main._chat_turn(req, request)), mocks


def test_connected_persists_exchange() -> None:
    out, mocks = _run_turn(disconnected=False)

    mocks["save_exchange"].assert_called_once()
    call = mocks["save_exchange"].call_args
    # reply 是 save_exchange 的第三个位置参数（conversation_id, user_text, reply_text）
    assert call.args[2] == "ok"
    assert call.kwargs["used_llm"] is True
    assert out["conversation_id"] == "c-1"
    assert "discarded" not in out


def test_disconnected_skips_persist() -> None:
    out, mocks = _run_turn(disconnected=True)

    mocks["save_exchange"].assert_not_called()
    assert out["discarded"] is True
    assert out["reply"] == "ok"
    assert out["conversation_id"] is None
