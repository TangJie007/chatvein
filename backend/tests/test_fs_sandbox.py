"""文件系统工具绑定当前会话工作区，而非主空间根。"""

import threading
from pathlib import Path

import pytest

from mcps.bash_approval import decide, list_pending
from mcps.sandbox import create_conversation_dir, current_sandbox, use_conversation_sandbox
from mcps.tools.fs import (
    delete_path,
    heuristic,
    list_allowed_directories,
    list_directory,
    write_file,
)
from mcps.workspace import workspace_root


def test_write_file_lands_in_session_not_main_root() -> None:
    name = create_conversation_dir()
    with use_conversation_sandbox(name):
        session = current_sandbox()
        result = write_file.invoke({"path": "output/hello.txt", "content": "你好"})
        assert result.startswith("Successfully wrote")
        written = session / "output" / "hello.txt"
        assert written.read_text(encoding="utf-8") == "你好"
        assert not (workspace_root() / "output" / "hello.txt").exists()


def test_write_file_accepts_absolute_path_inside_session() -> None:
    name = create_conversation_dir()
    with use_conversation_sandbox(name):
        session = current_sandbox().resolve()
        abs_path = str(session / "output" / "abs.txt")
        result = write_file.invoke({"path": abs_path, "content": "完整路径"})
        assert result.startswith("Successfully wrote")
        assert (session / "output" / "abs.txt").read_text(encoding="utf-8") == "完整路径"


def test_outside_session_requires_absolute_and_approval(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("CHATVEIN_BASH_APPROVAL_TIMEOUT", "5")
    name = create_conversation_dir()
    outside = workspace_root().resolve() / "outside_note.txt"
    outside.write_text("old", encoding="utf-8")
    box: dict[str, str] = {}

    def worker() -> None:
        with use_conversation_sandbox(name):
            rel = write_file.invoke({"path": "../outside_note.txt", "content": "no"})
            box["rel"] = str(rel)
            denied = write_file.invoke({"path": str(outside), "content": "denied"})
            box["denied"] = str(denied)
            allowed = write_file.invoke({"path": str(outside), "content": "ok"})
            box["allowed"] = str(allowed)

    thread = threading.Thread(target=worker)
    thread.start()

    # first outside attempt → deny
    for _ in range(100):
        pending = list_pending()
        if pending:
            assert decide(str(pending[0]["id"]), allow=False)
            break
        thread.join(0.05)
    # second → allow
    for _ in range(100):
        pending = list_pending()
        if pending:
            assert decide(str(pending[0]["id"]), allow=True)
            break
        thread.join(0.05)
    thread.join(15)

    assert "绝对路径" in box["rel"]
    assert "拒绝" in box["denied"] or "已拒绝" in box["denied"]
    assert box["allowed"].startswith("Successfully wrote")
    assert outside.read_text(encoding="utf-8") == "ok"
    outside.unlink(missing_ok=True)


def test_list_and_delete_scoped_to_session() -> None:
    name = create_conversation_dir()
    with use_conversation_sandbox(name):
        session = current_sandbox()
        write_file.invoke({"path": "output/note.txt", "content": "x"})
        listing = list_directory.invoke({"path": "output"})
        assert "note.txt" in listing
        allowed = list_allowed_directories.invoke({})
        assert str(session) in allowed
        assert delete_path.invoke({"path": "."}) == "不能删除会话工作区根目录"
        assert delete_path.invoke({"path": "output/note.txt"}).startswith("已删除")
        assert not (session / "output" / "note.txt").exists()


def test_fs_requires_session_context() -> None:
    assert "会话" in write_file.invoke({"path": "a.txt", "content": "x"})


def test_heuristic_picks_write_for_generate_txt() -> None:
    names = heuristic("生成 .txt 文件 里面写你好")
    assert "write_file" in names
