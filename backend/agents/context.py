"""上下文装配：按 token 预算压缩较早历史。

设计要点：

- **只在超预算时压缩**：历史能装下就原样送入，不改写、不损失信息。
- **压缩 = 摘要 + 保留最近若干轮原文**：比「按条数直接截断」保留更多关键事实。
- **多级降级**：LLM 摘要失败 → 抽取式摘要 → 关闭开关时回退旧的按条数截断。
- **可缓存**：摘要写回会话库 ``context_summaries``，同一区间不重复付费。
"""

from __future__ import annotations

import os
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterator

from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage
from pydantic import BaseModel, Field

from trace.recording import note

from .memory import DEFAULT_HISTORY_LIMIT, to_lc_messages
from .token_budget import (
    ContextBudget,
    count_message_tokens,
    count_rows_tokens,
    count_text_tokens,
    resolve_budget,
)

_SUMMARY_MAX_CHARS = 1600
_LLM_INPUT_MAX_CHARS = 12_000
_MAX_KEPT_FACTS = 8


class _SummaryResult(BaseModel):
    """摘要结构化输出。"""

    summary: str = Field(default="", description="较早对话的压缩摘要，保留事实与决策")
    kept_facts: list[str] = Field(default_factory=list, description="必须保留的关键事实")


@dataclass
class AssembledContext:
    """装配结果：喂给模型的 messages + 可观测数据。"""

    messages: list[BaseMessage]
    summary: str = ""
    degraded: bool = False
    compacted_ids: list[int] = field(default_factory=list)
    token_report: dict[str, Any] = field(default_factory=dict)


class SummaryCache:
    """摘要缓存：按 ``(first_message_id, last_message_id)`` 命中会话库。"""

    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path

    def get(self, first_id: int, last_id: int) -> str | None:
        try:
            from conversations import session_store  # pyright: ignore[reportImplicitRelativeImport]

            return session_store.get_context_summary(self.db_path, first_id, last_id)
        except Exception:  # noqa: BLE001 - 缓存不可用不应影响主流程
            return None

    def put(
        self,
        first_id: int,
        last_id: int,
        summary: str,
        *,
        kept_facts: list[str] | None = None,
        tokens: int = 0,
    ) -> None:
        try:
            from conversations import session_store  # pyright: ignore[reportImplicitRelativeImport]

            session_store.save_context_summary(
                self.db_path,
                first_message_id=first_id,
                last_message_id=last_id,
                summary=summary,
                kept_facts=kept_facts,
                tokens=tokens,
            )
        except Exception:  # noqa: BLE001
            return


_cache_var: ContextVar[SummaryCache | None] = ContextVar(
    "chatvein_summary_cache", default=None
)


@contextmanager
def use_summary_cache(db_path: Path) -> Iterator[None]:
    """绑定本轮的摘要缓存。须与 trace / 沙箱在同一工作线程内设置。"""
    token = _cache_var.set(SummaryCache(db_path))
    try:
        yield
    finally:
        _cache_var.reset(token)


def _env_flag(name: str, default: bool) -> bool:
    raw = (os.environ.get(name) or "").strip().lower()
    if not raw:
        return default
    return raw not in ("0", "false", "no", "off")


def _env_int(name: str, default: int) -> int:
    try:
        raw = (os.environ.get(name) or "").strip()
        return int(raw) if raw else default
    except ValueError:
        return default


def _clip(text: str, limit: int) -> str:
    text = (text or "").strip()
    if len(text) <= limit:
        return text
    return text[:limit].rstrip() + "…"


def _usable_rows(history: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for row in history or []:
        if not isinstance(row, dict):
            continue
        role = str(row.get("role") or "")
        content = str(row.get("content") or "").strip()
        if not content:
            continue
        if role not in ("user", "assistant", "system"):
            continue
        rows.append({**row, "content": content})
    return rows


def _legacy(rows: list[dict[str, Any]]) -> AssembledContext:
    """关闭压缩 / 异常兜底：与旧 ``to_lc_messages(history)`` 行为一致。"""
    messages = to_lc_messages(rows, limit=DEFAULT_HISTORY_LIMIT)
    return AssembledContext(
        messages=messages,
        degraded=True,
        token_report={"legacy": True, "after_tokens": count_message_tokens(messages)},
    )


def _extractive_summary(rows: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    for row in rows[-12:]:
        content = str(row.get("content") or "").replace("\n", " ").strip()
        parts.append(f"{row.get('role')}: {content[:160]}")
    return _clip("（抽取式摘要）\n" + "\n".join(parts), _SUMMARY_MAX_CHARS)


def _llm_summary(rows: list[dict[str, Any]], model: Any) -> str:
    from . import llm as llm_mod

    convo = "\n".join(
        f"{row.get('role')}: {str(row.get('content') or '')}" for row in rows
    )
    prompt = [
        SystemMessage(
            content=(
                "把下面较早的对话压缩成一段摘要。只保留：用户偏好与约束、已做出的决定、"
                "关键事实与数据、产物路径、尚未完成的待办。不要复述寒暄，不要编造。"
            )
        ),
        HumanMessage(content=_clip(convo, _LLM_INPUT_MAX_CHARS)),
    ]
    result = llm_mod.invoke_structured(model, _SummaryResult, prompt)
    text = str(getattr(result, "summary", "") or "").strip()
    facts = list(getattr(result, "kept_facts", []) or [])
    if facts:
        bullets = "；".join(str(f).strip() for f in facts[:_MAX_KEPT_FACTS] if str(f).strip())
        if bullets:
            text = f"{text}\n要点：{bullets}".strip()
    return _clip(text, _SUMMARY_MAX_CHARS)


def _summarize(
    rows: list[dict[str, Any]], model: Any | None
) -> tuple[str, bool, list[str]]:
    """返回 (摘要, 是否降级, 结构化要点)。"""
    cache = _cache_var.get()
    first_id = rows[0].get("id")
    last_id = rows[-1].get("id")
    if cache is not None and first_id is not None and last_id is not None:
        hit = cache.get(int(first_id), int(last_id))
        if hit:
            return str(hit), False, []

    if model is not None and _env_flag("CHATVEIN_CTX_SUMMARY_LLM", True):
        try:
            text = _llm_summary(rows, model)
            if text:
                if cache is not None and first_id is not None and last_id is not None:
                    cache.put(int(first_id), int(last_id), text, tokens=count_text_tokens(text))
                return text, False, []
        except Exception:  # noqa: BLE001 - 摘要失败不能拖垮主流程
            pass

    text = _extractive_summary(rows)
    if cache is not None and first_id is not None and last_id is not None:
        cache.put(int(first_id), int(last_id), text, tokens=count_text_tokens(text))
    return text, True, []


def _fit_rows(rows: list[dict[str, Any]], budget_tokens: int) -> list[dict[str, Any]]:
    """从新到旧保留整行，装不下的最后一行按剩余预算截断内容。"""
    kept: list[dict[str, Any]] = []
    remaining = max(64, budget_tokens)
    for row in reversed(rows):
        cost = count_rows_tokens([row])
        if cost <= remaining:
            kept.append(row)
            remaining -= cost
            continue
        chars = max(40, remaining * 4)
        kept.append({**row, "content": _clip(str(row.get("content") or ""), chars)})
        break
    return list(reversed(kept))


def _build_messages(
    rows: list[dict[str, Any]], summary: str
) -> list[BaseMessage]:
    messages: list[BaseMessage] = []
    if summary:
        messages.append(SystemMessage(content=f"[历史摘要]\n{summary}"))
    messages.extend(to_lc_messages(rows, limit=max(1, len(rows))))
    return messages


def assemble_context(
    history: list[dict[str, Any]] | None,
    *,
    message: str,
    system_prompt: str = "",
    role: dict[str, Any] | None = None,
    summarizer_model: Any | None = None,
    compact: bool | None = None,
    budget: ContextBudget | None = None,
) -> AssembledContext:
    """把会话历史装配成模型输入（不含本轮用户句）。

    超预算时才压缩较早历史为摘要；其余情况原样保留。
    """
    rows = _usable_rows(history)
    if not rows:
        return AssembledContext(messages=[], token_report={"before_tokens": 0, "after_tokens": 0})

    enabled = compact if compact is not None else _env_flag("CHATVEIN_CTX_COMPACT", True)
    if not enabled:
        return _legacy(rows)

    try:
        resolved = budget or resolve_budget(
            model_id=str((role or {}).get("model_id") or "") or None,
            role=role,
            system_prompt=system_prompt,
            input_text=message,
        )
        recent_turns = max(1, _env_int("CHATVEIN_CTX_RECENT_TURNS", 6))
        recent_count = recent_turns * 2
        recent_rows = rows[-recent_count:]
        older_rows = rows[:-recent_count]

        before_tokens = count_rows_tokens(rows)
        summary = ""
        degraded = False
        compacted_ids: list[int] = []

        if older_rows and before_tokens > resolved.history_budget:
            summary, degraded, _ = _summarize(older_rows, summarizer_model)
            compacted_ids = [
                int(row["id"]) for row in older_rows if row.get("id") is not None
            ]
            summary_tokens = count_text_tokens(summary) + 4
            remaining = resolved.history_budget - summary_tokens
            if count_rows_tokens(recent_rows) > remaining:
                recent_rows = _fit_rows(recent_rows, remaining)

        messages = _build_messages(recent_rows, summary)
        report = {
            **resolved.report(),
            "before_tokens": before_tokens,
            "after_tokens": count_message_tokens(messages),
            "compacted_messages": len(compacted_ids),
            "summary_chars": len(summary),
            "degraded": degraded,
        }
        note(
            "context",
            name="context",
            detail={
                "before_tokens": report["before_tokens"],
                "after_tokens": report["after_tokens"],
                "history_budget": resolved.history_budget,
                "compacted_messages": len(compacted_ids),
                "summary_chars": len(summary),
                "degraded": degraded,
            },
        )
        return AssembledContext(
            messages=messages,
            summary=summary,
            degraded=degraded,
            compacted_ids=compacted_ids,
            token_report=report,
        )
    except Exception:  # noqa: BLE001 - 装配失败一律回退旧行为
        return _legacy(rows)
