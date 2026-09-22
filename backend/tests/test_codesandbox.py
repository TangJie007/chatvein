"""会话工作区目录与代码沙箱。"""

from __future__ import annotations

import re

from sqlmodel import Session

import db
from conversations.entity import Conversation, CreateConversationDto
from conversations.service import ConversationsService
from mcps.sandbox import use_conversation_sandbox
from mcps.tools.sandbox import (
    sandbox_create_venv,
    sandbox_pip_install,
    sandbox_run_python,
    sandbox_write_file,
)
from mcps.workspace import workspace_root

_DIR = re.compile(r"^\d{8}-\d{6}-[a-z0-9]{5}$")


def test_new_conversation_gets_timestamp_workspace() -> None:
    service = ConversationsService()
    created = service.create_conversation(CreateConversationDto(title="草稿"))
    name = created["workspace_dir"]
    assert _DIR.fullmatch(name)
    folder = workspace_root() / name
    assert folder.is_dir()
    assert folder.parent == workspace_root()
    assert (folder / "output").is_dir()
    assert (folder / "logs").is_dir()
    assert (folder / "runs").is_dir()
    assert (folder / "logs" / "session.sqlite").is_file()

    again, _, _ = service.save_exchange(created["id"], "继续", "好")
    stored = service.get_conversation(again)
    assert stored is not None
    assert stored["workspace_dir"] == name

    assert service.delete_conversation(created["id"]) is True
    assert not folder.exists()


def test_open_for_chat_reuses_folder_and_backfills_old_rows() -> None:
    service = ConversationsService()
    with Session(db.get_engine()) as session:
        conversation = Conversation(title="旧会话", workspace_dir="")
        session.add(conversation)
        session.commit()
        conversation_id = conversation.id

    opened = service.open_for_chat(conversation_id, "把这段补上工作区")
    assert opened["id"] == conversation_id
    assert _DIR.fullmatch(opened["workspace_dir"])
    reused = service.open_for_chat(conversation_id, "再来一次")
    assert reused["workspace_dir"] == opened["workspace_dir"]

    fresh = service.open_for_chat("missing", "全新问题")
    assert fresh["id"] != "missing"
    assert fresh["workspace_dir"] != opened["workspace_dir"]
    assert (workspace_root() / fresh["workspace_dir"]).is_dir()


def test_sandbox_rejects_escape_then_runs_python() -> None:
    service = ConversationsService()
    created = service.create_conversation(CreateConversationDto())
    name = created["workspace_dir"]
    with use_conversation_sandbox(name):
        escaped = sandbox_write_file.invoke({"path": "../outside.py", "content": "print(1)"})
        assert "越界" in str(escaped) or "runs" in str(escaped).lower()
        blocked = sandbox_write_file.invoke({"path": ".venv/evil.py", "content": "print(1)"})
        assert "虚拟环境" in str(blocked)

        # 会话内绝对路径也可写 runs/
        abs_script = str((workspace_root() / name / "runs" / "abs_main.py").resolve())
        abs_ok = sandbox_write_file.invoke({"path": abs_script, "content": "print(3)\n"})
        assert str(abs_ok).startswith("已写入")
        abs_outside = str((workspace_root() / "evil.py").resolve())
        abs_blocked = sandbox_write_file.invoke({"path": abs_outside, "content": "x"})
        assert "越界" in str(abs_blocked)

        created_venv = sandbox_create_venv.invoke({})
        assert "虚拟环境" in str(created_venv)
        ran = sandbox_run_python.invoke(
            {"path": "main.py", "code": "print(1 + 1)\n", "timeout_seconds": 30}
        )
        text = str(ran)
        assert "exit=0" in text
        assert "2" in text
        root = workspace_root() / name
        assert (root / "runs" / "main.py").is_file()
        assert (root / "runs" / ".venv").is_dir()
        assert not (root / "main.py").exists()
        assert not (root / ".venv").exists()

        # cwd 是会话根：相对 output/ 写文件应落在会话产物目录
        wrote = sandbox_run_python.invoke(
            {
                "path": "write_out.py",
                "code": (
                    "from pathlib import Path\n"
                    "Path('output/from_sandbox.txt').write_text('你好', encoding='utf-8')\n"
                    "print('ok')\n"
                ),
                "timeout_seconds": 30,
            }
        )
        assert "exit=0" in str(wrote)
        assert (root / "output" / "from_sandbox.txt").read_text(encoding="utf-8") == "你好"
        assert not (root / "runs" / "output" / "from_sandbox.txt").exists()

        rejected = sandbox_pip_install.invoke({"packages": "-r requirements.txt"})
        assert "不合法" in str(rejected)

    outside = workspace_root().parent / "outside.py"
    assert not outside.exists()


def test_session_store_short_term_memory_and_tools() -> None:
    service = ConversationsService()
    created = service.create_conversation(CreateConversationDto(title="记忆"))
    name = created["workspace_dir"]
    service.record_turn(
        name,
        user_text="你好",
        reply_text="你好呀",
        route="simple",
        used_llm=False,
        tool_trace=[
            {
                "tool_name": "get_current_time",
                "arguments": {},
                "result_text": "12:00",
                "status": "ok",
            }
        ],
    )
    memory = service.short_term_memory(name)
    assert len(memory) == 2
    assert memory[0]["role"] == "user"
    assert memory[1]["content"] == "你好呀"
    insight = service.workspace_insight(created["id"])
    assert insight is not None
    assert insight["memory_count"] == 2
    assert insight["tool_calls"][0]["tool_name"] == "get_current_time"
    assert (workspace_root() / name / "output").is_dir()
