"""上下文装配：预算、压缩、降级、缓存。"""

from __future__ import annotations

from pathlib import Path

import pytest
from langchain_core.messages import SystemMessage

from agents import context as context_mod
from agents.context import assemble_context, use_summary_cache
from agents.token_budget import (
    ContextBudget,
    count_message_tokens,
    count_text_tokens,
    estimate_text_tokens,
)
from conversations import session_store


def _rows(count: int, *, chars: int = 80) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for index in range(count):
        role = "user" if index % 2 == 0 else "assistant"
        rows.append(
            {
                "id": index + 1,
                "role": role,
                "content": f"第{index}轮：" + "内容" * (chars // 2),
            }
        )
    return rows


def _tiny_budget() -> ContextBudget:
    # history_budget = max(512, 1200 - 512 - 0 - 0 - 256) = 512
    return ContextBudget(
        context_window=1200,
        output_reserve=512,
        system_tokens=0,
        input_tokens=0,
    )


def test_token_estimate_scales_with_length() -> None:
    assert count_text_tokens("") == 0
    short = count_text_tokens("你好")
    long = count_text_tokens("你好" * 100)
    assert short >= 1
    assert long > short
    assert estimate_text_tokens("hello world") >= 1


def test_budget_history_respects_floor() -> None:
    budget = ContextBudget(
        context_window=1000, output_reserve=900, system_tokens=0, input_tokens=0
    )
    assert budget.history_budget == 512


def test_no_compaction_when_history_fits() -> None:
    rows = _rows(6, chars=8)
    assembled = assemble_context(
        rows,
        message="继续",
        budget=ContextBudget(
            context_window=100_000, output_reserve=4096, system_tokens=0, input_tokens=0
        ),
    )
    assert assembled.summary == ""
    assert assembled.compacted_ids == []
    assert len(assembled.messages) == len(rows)
    assert assembled.token_report["compacted_messages"] == 0


def test_over_budget_summarizes_older_history(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("CHATVEIN_CTX_RECENT_TURNS", "2")
    rows = _rows(40, chars=80)
    assembled = assemble_context(
        rows, message="继续", budget=_tiny_budget(), summarizer_model=None
    )
    assert assembled.summary
    assert assembled.degraded is True  # 无模型 → 抽取式摘要
    assert assembled.compacted_ids == [row["id"] for row in rows[:-4]]
    assert any(
        isinstance(message, SystemMessage) and "[历史摘要]" in str(message.content)
        for message in assembled.messages
    )
    assert assembled.token_report["compacted_messages"] == 36
    assert "before_tokens" in assembled.token_report


def test_compact_disabled_falls_back_to_legacy_trim(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CHATVEIN_CTX_COMPACT", "0")
    rows = _rows(40, chars=20)
    assembled = assemble_context(rows, message="继续", budget=_tiny_budget())
    assert assembled.degraded is True
    assert assembled.summary == ""
    assert len(assembled.messages) <= 24


def test_summary_cache_avoids_second_llm_call(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    db_path = tmp_path / "session.sqlite"
    calls: list[int] = []

    def fake_llm_summary(rows: list[dict[str, object]], model: object) -> str:
        calls.append(1)
        return "缓存摘要内容"

    monkeypatch.setattr(context_mod, "_llm_summary", fake_llm_summary)
    monkeypatch.setenv("CHATVEIN_CTX_RECENT_TURNS", "2")
    rows = _rows(30, chars=80)

    with use_summary_cache(db_path):
        first = assemble_context(
            rows, message="继续", budget=_tiny_budget(), summarizer_model=object()
        )
        second = assemble_context(
            rows, message="继续", budget=_tiny_budget(), summarizer_model=object()
        )

    assert len(calls) == 1
    assert first.summary == "缓存摘要内容"
    assert second.summary == "缓存摘要内容"
    assert first.degraded is False

    stored = session_store.get_context_summary(
        db_path, int(rows[0]["id"]), int(rows[-5]["id"])
    )
    assert stored == "缓存摘要内容"


def test_session_store_summary_roundtrip(tmp_path: Path) -> None:
    db_path = tmp_path / "session.sqlite"
    session_store.save_context_summary(
        db_path,
        first_message_id=1,
        last_message_id=10,
        summary="摘要",
        kept_facts=["偏好中文", "项目用 Python"],
        tokens=12,
    )
    assert session_store.get_context_summary(db_path, 1, 10) == "摘要"
    assert session_store.get_context_summary(db_path, 2, 10) is None

    session_store.save_context_summary(
        db_path,
        first_message_id=1,
        last_message_id=10,
        summary="新摘要",
        tokens=8,
    )
    assert session_store.get_context_summary(db_path, 1, 10) == "新摘要"


def test_messages_token_count_matches_content() -> None:
    from langchain_core.messages import HumanMessage

    messages = [HumanMessage(content="你好"), SystemMessage(content="规则")]
    assert count_message_tokens(messages) > 0
