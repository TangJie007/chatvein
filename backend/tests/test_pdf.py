"""PDF 工具（mcp-pdf）测试。

夹具用 reportlab 现场生成带文本 / 空白的测试 PDF；工具调用走
``tool.invoke``，与 test_ocr.py 保持一致。
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import TYPE_CHECKING

import pytest

from conversations.entity import CreateConversationDto
from conversations.service import ConversationsService
from mcps.registry import tool_groups
from mcps.sandbox import use_conversation_sandbox
from mcps.tools import pdf as pdf_mod
from mcps.tools.pdf import (
    pdf_decrypt,
    pdf_encrypt,
    pdf_generate,
    pdf_info,
    pdf_merge,
    pdf_read,
    pdf_split,
    pdf_split_files,
)

if TYPE_CHECKING:
    from reportlab.platypus import Flowable


@pytest.fixture
def sandbox() -> Iterator[Path]:
    service = ConversationsService()
    created = service.create_conversation(CreateConversationDto(title="pdf-test"))
    name = created["workspace_dir"]
    with use_conversation_sandbox(name) as root:
        yield root


def _build_pdf(path: Path, contents: list[str]) -> None:
    """用 reportlab 生成测试 PDF；每段独占一页；空列表 = 一页空白。"""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import cm
    from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer

    doc = SimpleDocTemplate(
        str(path),
        pagesize=A4,
        topMargin=2 * cm,
        bottomMargin=2 * cm,
        leftMargin=2.5 * cm,
        rightMargin=2.5 * cm,
    )
    story: list[Flowable] = []
    style = ParagraphStyle("body", fontName="Helvetica", fontSize=11, leading=17)
    for index, text in enumerate(contents):
        story.append(Paragraph(text, style))
        story.append(Spacer(1, 8))
        if index < len(contents) - 1:
            story.append(PageBreak())
    doc.build(story)


def test_pdf_group_registered() -> None:
    groups = tool_groups()
    assert "mcp-pdf" in groups
    names = set(groups["mcp-pdf"])
    assert {
        "pdf_info",
        "pdf_read",
        "pdf_merge",
        "pdf_split",
        "pdf_split_files",
        "pdf_generate",
        "pdf_encrypt",
        "pdf_decrypt",
    } <= names


def test_heuristic() -> None:
    assert pdf_mod.heuristic("合并两个 pdf 文件") == ["pdf_merge"]
    assert pdf_mod.heuristic("帮我拆 pdf") == ["pdf_split"]
    assert pdf_mod.heuristic("把每页拆成单独文件") == ["pdf_split_files"]
    assert pdf_mod.heuristic("生成 pdf 文档") == ["pdf_generate"]
    assert pdf_mod.heuristic("把这份 pdf 加密") == ["pdf_encrypt"]
    assert pdf_mod.heuristic("帮我把 pdf 解密") == ["pdf_decrypt"]
    assert pdf_mod.heuristic("看下这个 pdf 有多少页") == ["pdf_info"]
    assert pdf_mod.heuristic("读取这个 pdf 的正文") == ["pdf_read"]
    assert pdf_mod.heuristic("今天天气怎么样") == []


def test_info_and_read(sandbox: Path) -> None:
    _build_pdf(
        sandbox / "a.pdf",
        [
            "Hello PDF One. This page carries a full body of text for extraction.",
            "Hello PDF Two. This page also carries a full body of text.",
        ],
    )

    info = pdf_info.invoke({"path": "a.pdf"})
    assert "页数: 2" in info
    assert "加密: False" in info
    assert "页面尺寸:" in info

    body = pdf_read.invoke({"path": "a.pdf"})
    assert "Hello PDF One" in body
    assert "Hello PDF Two" in body
    assert "--- 第 1 页 ---" in body
    assert "--- 第 2 页 ---" in body
    assert "疑似扫描件" not in body


def test_read_pages_filter(sandbox: Path) -> None:
    _build_pdf(sandbox / "a.pdf", ["First Page Text", "Second Page Text"])

    body = pdf_read.invoke({"path": "a.pdf", "pages": "2"})
    assert "Second Page Text" in body
    assert "First Page Text" not in body
    assert "--- 第 2 页 ---" in body

    body_all = pdf_read.invoke({"path": "a.pdf", "pages": "1-2"})
    assert "First Page Text" in body_all
    assert "Second Page Text" in body_all


def test_read_max_chars_truncates(sandbox: Path) -> None:
    _build_pdf(sandbox / "a.pdf", ["Text for page one.", "Text for page two.", "Text for page three."])
    body = pdf_read.invoke({"path": "a.pdf", "max_chars": 30})
    assert "已截断" in body


def test_scanlike_detected(sandbox: Path) -> None:
    _build_pdf(sandbox / "scan.pdf", [])
    body = pdf_read.invoke({"path": "scan.pdf"})
    assert "疑似扫描件" in body


def test_split(sandbox: Path) -> None:
    _build_pdf(sandbox / "a.pdf", ["Page A", "Page B", "Page C"])
    out = pdf_split.invoke({"path": "a.pdf", "pages": "1,3"})
    assert "已写出" in out
    target = sandbox / "output" / "a_p1-3.pdf"
    assert target.is_file()
    info = pdf_info.invoke({"path": str(target)})
    assert "页数: 2" in info


def test_split_files_all(sandbox: Path) -> None:
    _build_pdf(sandbox / "a.pdf", ["Page A", "Page B", "Page C"])
    out = pdf_split_files.invoke({"path": "a.pdf"})
    assert "已拆分 3 页为 3 个文件" in out
    targets = [sandbox / "output" / f"a_{i}.pdf" for i in range(1, 4)]
    assert all(t.is_file() for t in targets)
    assert "Page A" in pdf_read.invoke({"path": str(targets[0])})
    assert "Page C" in pdf_read.invoke({"path": str(targets[2])})


def test_split_files_pages_and_prefix(sandbox: Path) -> None:
    _build_pdf(sandbox / "a.pdf", ["Page A", "Page B", "Page C"])
    out = pdf_split_files.invoke({"path": "a.pdf", "pages": "2,3", "output_prefix": "output/chunk"})
    assert "已拆分 2 页为 2 个文件" in out
    assert (sandbox / "output" / "chunk_2.pdf").is_file()
    assert (sandbox / "output" / "chunk_3.pdf").is_file()
    assert not (sandbox / "output" / "chunk_1.pdf").exists()
    assert "Page B" in pdf_read.invoke({"path": "output/chunk_2.pdf"})


def test_merge(sandbox: Path) -> None:
    _build_pdf(sandbox / "a.pdf", ["Page A"])
    _build_pdf(sandbox / "b.pdf", ["Page B"])
    out = pdf_merge.invoke({"paths": ["a.pdf", "b.pdf"], "output": "output/c.pdf"})
    assert "已写出" in out
    assert "2 页" in out
    info = pdf_info.invoke({"path": "output/c.pdf"})
    assert "页数: 2" in info


def test_merge_too_many(sandbox: Path) -> None:
    out = pdf_merge.invoke({"paths": [f"f{i}.pdf" for i in range(21)]})
    assert "一次最多合并" in out


def test_encrypt_decrypt_roundtrip(sandbox: Path) -> None:
    _build_pdf(sandbox / "secret.pdf", ["Secret Text"])
    out = pdf_encrypt.invoke({"path": "secret.pdf", "password": "pw123"})
    assert "已写出" in out
    enc = sandbox / "output" / "secret_encrypted.pdf"
    assert enc.is_file()

    info = pdf_info.invoke({"path": str(enc)})
    assert "加密: True" in info

    body = pdf_read.invoke({"path": str(enc)})
    assert "已加密" in body

    bad = pdf_decrypt.invoke({"path": str(enc), "password": "wrong"})
    assert "口令错误" in bad

    good = pdf_decrypt.invoke({"path": str(enc), "password": "pw123"})
    assert "已写出" in good
    dec = sandbox / "output" / "secret_encrypted_decrypted.pdf"
    assert dec.is_file()
    body2 = pdf_read.invoke({"path": str(dec)})
    assert "Secret Text" in body2


def test_decrypt_unencrypted(sandbox: Path) -> None:
    _build_pdf(sandbox / "plain.pdf", ["Plain Text"])
    out = pdf_decrypt.invoke({"path": "plain.pdf", "password": "x"})
    assert "文件未加密" in out


def test_encrypt_empty_password(sandbox: Path) -> None:
    _build_pdf(sandbox / "a.pdf", ["Hi"])
    out = pdf_encrypt.invoke({"path": "a.pdf", "password": ""})
    assert "password 不能为空" in out


def test_too_large(sandbox: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _build_pdf(sandbox / "a.pdf", ["Hello"])
    monkeypatch.setattr(pdf_mod, "_MAX_BYTES", 100)
    out = pdf_info.invoke({"path": "a.pdf"})
    assert "文件过大" in out


def test_too_many_pages(sandbox: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _build_pdf(sandbox / "a.pdf", ["P1", "P2", "P3"])
    monkeypatch.setattr(pdf_mod, "_MAX_PAGES", 2)
    out = pdf_info.invoke({"path": "a.pdf"})
    assert "页数过多" in out


def test_parse_pages() -> None:
    assert pdf_mod._parse_pages("1-3,5,8", 10) == ([0, 1, 2, 4, 7], None)
    assert pdf_mod._parse_pages("5", 5) == ([4], None)
    assert pdf_mod._parse_pages("", 10)[1] is not None
    assert pdf_mod._parse_pages("abc", 10)[1] is not None
    assert pdf_mod._parse_pages("0-2", 10)[1] is not None
    assert pdf_mod._parse_pages("3-1", 10)[1] is not None
    assert pdf_mod._parse_pages("9-12", 10)[1] is not None


def test_missing_and_bad_file(sandbox: Path) -> None:
    out = pdf_info.invoke({"path": "nope.pdf"})
    assert "不是文件或不存在" in out

    (sandbox / "bad.pdf").write_bytes(b"this is not a pdf")
    out2 = pdf_info.invoke({"path": "bad.pdf"})
    assert "解析 PDF 失败" in out2


def test_relative_path_escape(sandbox: Path) -> None:
    out = pdf_info.invoke({"path": "../outside.pdf"})
    assert "会话外" in out


def test_generate(sandbox: Path) -> None:
    out = pdf_generate.invoke({"text": "# 标题\n第一行内容\n\n第二段内容", "output": "output/gen.pdf"})
    assert "已生成" in out
    target = sandbox / "output" / "gen.pdf"
    assert target.is_file()
    info = pdf_info.invoke({"path": "output/gen.pdf"})
    assert "页数: 1" in info

    out_empty = pdf_generate.invoke({"text": "   "})
    assert "text 不能为空" in out_empty
