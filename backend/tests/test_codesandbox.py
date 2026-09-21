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
        assert "越界" in str(escaped)
        blocked = sandbox_write_file.invoke({"path": ".venv/evil.py", "content": "print(1)"})
        assert "虚拟环境" in str(blocked)

        created_venv = sandbox_create_venv.invoke({})
        assert "虚拟环境" in str(created_venv)
        ran = sandbox_run_python.invoke(
            {"path": "main.py", "code": "print(1 + 1)\n", "timeout_seconds": 30}
        )
        text = str(ran)
        assert "exit=0" in text
        assert "2" in text
        assert (workspace_root() / name / "main.py").is_file()
        assert (workspace_root() / name / ".venv").is_dir()

        rejected = sandbox_pip_install.invoke({"packages": "-r requirements.txt"})
        assert "不合法" in str(rejected)

    outside = workspace_root().parent / "outside.py"
    assert not outside.exists()
