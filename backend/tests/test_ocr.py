"""OCR：OCR.space 优先，失败再沙箱 RapidOCR。"""

from __future__ import annotations

import pytest

from conversations.entity import CreateConversationDto
from conversations.service import ConversationsService
from mcps.registry import tool_groups
from mcps.sandbox import current_sandbox, use_conversation_sandbox
from mcps.tools import ocr as ocr_mod
from mcps.tools import sandbox as sandbox_mod
from mcps.tools.ocr import ocr_image


def test_ocr_group_registered() -> None:
    assert "mcp-ocr" in tool_groups()
    assert "ocr_image" in tool_groups()["mcp-ocr"]


def test_ocr_space_success(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {
                "IsErroredOnProcessing": False,
                "ParsedResults": [{"ParsedText": "你好世界\n"}],
            }

    monkeypatch.setattr(ocr_mod.httpx, "post", lambda *_a, **_k: FakeResponse())
    out = ocr_image.invoke(
        {"source": "https://example.com/a.png", "language": "chs"}
    )
    assert "ocr.space" in out
    assert "你好世界" in out


def test_ocr_falls_back_to_sandbox_script(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeResponse:
        def raise_for_status(self) -> None:
            raise RuntimeError("down")

    monkeypatch.setattr(ocr_mod.httpx, "post", lambda *_a, **_k: FakeResponse())

    calls: list[str] = []

    class FakeTool:
        def __init__(self, name: str, reply: str) -> None:
            self._name = name
            self._reply = reply

        def invoke(self, args=None):
            calls.append(f"{self._name}:{args}")
            return self._reply

    monkeypatch.setattr(
        sandbox_mod, "sandbox_create_venv", FakeTool("venv", "虚拟环境已存在: x")
    )
    monkeypatch.setattr(
        sandbox_mod,
        "sandbox_pip_install",
        FakeTool("pip", "exit=0\nstdout:\nok\nstderr:\n"),
    )
    monkeypatch.setattr(
        sandbox_mod,
        "sandbox_run_python",
        FakeTool(
            "run",
            "exit=0\nstdout:\nOCR_TEXT_BEGIN\n本地识别结果\nOCR_TEXT_END\nstderr:\n",
        ),
    )

    service = ConversationsService()
    created = service.create_conversation(CreateConversationDto(title="ocr"))
    name = created["workspace_dir"]

    with use_conversation_sandbox(name):
        root = current_sandbox()
        (root / "shot.png").write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 32)
        out = ocr_image.invoke({"source": "shot.png", "language": "chs"})

    assert "sandbox-rapidocr" in out
    assert "本地识别结果" in out
    assert any(c.startswith("venv:") for c in calls)
    assert any(c.startswith("pip:") for c in calls)
    assert any(c.startswith("run:") for c in calls)
