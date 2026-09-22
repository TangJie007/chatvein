"""会话业务逻辑。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import uuid

from mcps.sandbox import (  # pyright: ignore[reportImplicitRelativeImport]
    conversation_root,
    init_conversation_layout,
    output_dir,
    session_db_path,
)

from . import session_store
from .entity import ConversationRecord, CreateConversationDto, MessageRecord, Role
from .repository import ConversationsRepository


class ConversationsService:
    def __init__(self, repository: ConversationsRepository | None = None) -> None:
        self._repo = repository or ConversationsRepository()

    def list_conversations(self, limit: int = 50) -> list[ConversationRecord]:
        return self._repo.list(limit)

    def create_conversation(self, dto: CreateConversationDto) -> ConversationRecord:
        return self._repo.create(dto.title)

    def get_conversation(self, conversation_id: str) -> ConversationRecord | None:
        return self._repo.get(conversation_id)

    def delete_conversation(self, conversation_id: str) -> bool:
        return self._repo.delete(conversation_id)

    def clear_conversations(self) -> int:
        return self._repo.clear()

    def list_messages(self, conversation_id: str) -> list[MessageRecord]:
        rows = self._repo.list_messages(conversation_id)
        if not rows:
            rows = self._rehydrate_messages_from_session(conversation_id)
        return self._enrich_metrics_from_traces(conversation_id, rows)

    def _session_db_for(self, conversation_id: str) -> Path | None:
        conversation = self._repo.get(conversation_id)
        if conversation is None:
            return None
        name = (conversation.get("workspace_dir") or "").strip()
        if not name:
            return None
        try:
            return session_db_path(self.workspace_root_for(name))
        except Exception:
            return None

    def _trace_metrics_by_turn(self, db_path: Path) -> dict[str, tuple[int, int]]:
        """turn_id → (total_tokens, elapsed_ms)，来自会话库 turn_traces。"""
        from trace.store import list_turn_traces  # pyright: ignore[reportImplicitRelativeImport]

        metrics: dict[str, tuple[int, int]] = {}
        try:
            for item in list_turn_traces(db_path):
                turn_id = str(item.get("turn_id") or "").strip()
                if not turn_id:
                    continue
                totals = item.get("totals") if isinstance(item.get("totals"), dict) else {}
                tokens = int(totals.get("total_tokens") or 0)
                elapsed = int(item.get("elapsed_ms") or 0)
                if tokens or elapsed:
                    metrics[turn_id] = (tokens, elapsed)
        except Exception:
            return {}
        return metrics

    def _rehydrate_messages_from_session(self, conversation_id: str) -> list[MessageRecord]:
        """主库消息被误删时，从会话空间 ``session.sqlite`` 回填。"""
        db = self._session_db_for(conversation_id)
        if db is None:
            return []
        try:
            session_rows = session_store.list_messages(db, limit=200)
        except Exception:
            return []
        if not session_rows:
            return []
        metrics = self._trace_metrics_by_turn(db)
        enriched: list[dict[str, Any]] = []
        for row in session_rows:
            item = dict(row)
            turn_id = str(item.get("turn_id") or "").strip()
            if turn_id and turn_id in metrics:
                tokens, elapsed = metrics[turn_id]
                item["tokens"] = tokens
                item["duration_ms"] = elapsed
            enriched.append(item)
        return self._repo.import_messages(conversation_id, enriched)

    def _enrich_metrics_from_traces(
        self, conversation_id: str, rows: list[MessageRecord]
    ) -> list[MessageRecord]:
        """已有消息若缺 tokens/耗时，从 turn_traces 补全并写回主库。"""
        need = [
            r
            for r in rows
            if r.get("role") == "assistant"
            and (r.get("turn_id") or "").strip()
            and (not int(r.get("tokens") or 0) or not int(r.get("duration_ms") or 0))
        ]
        if not need:
            return rows
        db = self._session_db_for(conversation_id)
        if db is None:
            return rows
        metrics = self._trace_metrics_by_turn(db)
        if not metrics:
            return rows
        updates: dict[str, tuple[int, int]] = {}
        for row in need:
            turn_id = str(row.get("turn_id") or "").strip()
            if turn_id in metrics:
                updates[turn_id] = metrics[turn_id]
        if not updates:
            return rows
        self._repo.apply_turn_metrics(conversation_id, updates)
        return self._repo.list_messages(conversation_id)

    def delete_last_exchange(
        self,
        conversation_id: str,
        *,
        user_content: str | None = None,
        after_message_id: int | None = None,
    ) -> int:
        """撤回 / 停止：删除最近一轮对话（主库消息 + 会话空间短期记忆）。

        ``user_content`` / ``after_message_id`` 用于只删本轮，避免误伤历史。
        返回主库删除的消息条数。
        """
        removed = self._repo.delete_last_exchange(
            conversation_id,
            user_content=user_content,
            after_message_id=after_message_id,
        )
        if removed <= 0:
            return 0
        conversation = self._repo.get(conversation_id)
        if conversation and conversation.get("workspace_dir"):
            root = self.workspace_root_for(str(conversation["workspace_dir"]))
            db_path = session_db_path(root)
            try:
                session_store.delete_last_exchange(db_path)
            except Exception:
                # 会话空间库缺失或损坏不应阻断撤回
                pass
        return removed

    def add_message(
        self,
        conversation_id: str,
        role: Role,
        content: str,
        *,
        used_llm: bool = False,
        route: str | None = None,
    ) -> MessageRecord:
        return self._repo.add_message(
            conversation_id, role, content, used_llm=used_llm, route=route
        )

    def open_for_chat(self, conversation_id: str | None, title_hint: str) -> ConversationRecord:
        return self._repo.open_for_chat(conversation_id, title_hint)

    def save_exchange(
        self,
        conversation_id: str | None,
        user_text: str,
        reply_text: str,
        *,
        used_llm: bool = False,
        route: str | None = None,
        title_hint: str | None = None,
        turn_id: str | None = None,
        tokens: int = 0,
        duration_ms: int = 0,
    ) -> tuple[str, MessageRecord, MessageRecord]:
        return self._repo.save_exchange(
            conversation_id,
            user_text,
            reply_text,
            used_llm=used_llm,
            route=route,
            title_hint=title_hint,
            turn_id=turn_id,
            tokens=tokens,
            duration_ms=duration_ms,
        )

    def counts(self) -> dict[str, int]:
        return self._repo.counts()

    def workspace_root_for(self, workspace_dir: str) -> Path:
        return init_conversation_layout(conversation_root(workspace_dir))

    def short_term_memory(
        self,
        workspace_dir: str,
        *,
        conversation_id: str | None = None,
        limit: int = 24,
    ) -> list[dict[str, Any]]:
        """从会话 ``logs/session.sqlite`` 读取短期记忆；空则回落主库消息。"""
        db = session_db_path(self.workspace_root_for(workspace_dir))
        rows = session_store.list_messages(db, limit=limit)
        if rows:
            return rows
        if not conversation_id:
            return []
        fallback = self._repo.list_messages(conversation_id, limit=limit)
        return [
            {
                "id": int(m["id"]),
                "role": m["role"],
                "content": m["content"],
                "route": m.get("route"),
                "used_llm": bool(m.get("used_llm")),
                "created_at": m.get("created_at") or "",
            }
            for m in fallback
        ]

    def record_turn(
        self,
        workspace_dir: str,
        *,
        user_text: str,
        reply_text: str,
        route: str | None = None,
        used_llm: bool = False,
        tool_trace: list[dict[str, Any]] | None = None,
        route_reason: str | None = None,
        tool_plan: str | None = None,
        turn_id: str | None = None,
    ) -> None:
        """写入会话库：消息 + 本轮工具轨迹 + 本轮推理（route_reason / tool_plan）。"""
        root = self.workspace_root_for(workspace_dir)
        db = session_db_path(root)
        session_store.append_message(db, "user", user_text, route=route)
        turn_id = turn_id or uuid.uuid4().hex
        session_store.append_message(
            db,
            "assistant",
            reply_text,
            route=route,
            used_llm=used_llm,
            turn_id=turn_id,
            route_reason=route_reason,
            tool_plan=tool_plan,
        )
        for item in tool_trace or []:
            session_store.append_tool_call(
                db,
                tool_name=str(item.get("tool_name") or "unknown"),
                result_text=str(item.get("result_text") or ""),
                arguments=item.get("arguments"),
                tool_call_id=item.get("tool_call_id"),
                turn_id=turn_id,
                status=str(item.get("status") or "ok"),
            )

    def open_workspace_folder(self, conversation_id: str) -> str | None:
        """在系统文件管理器中打开该会话工作区。不存在则返回 ``None``。"""
        conversation = self._repo.get(conversation_id)
        if conversation is None:
            return None
        name = (conversation.get("workspace_dir") or "").strip()
        if not name:
            return None
        root = self.workspace_root_for(name)
        from mcps.tools.fs import _open_in_file_manager  # pyright: ignore[reportImplicitRelativeImport]

        _open_in_file_manager(str(root))
        return str(root)

    def workspace_insight(self, conversation_id: str) -> dict[str, Any] | None:
        """工作区路径、产物、最近工具调用（给洞察面板）。"""
        conversation = self._repo.get(conversation_id)
        if conversation is None:
            return None
        name = (conversation.get("workspace_dir") or "").strip()
        if not name:
            return {
                "conversation_id": conversation_id,
                "workspace_dir": "",
                "paths": {},
                "artifacts": [],
                "tool_calls": [],
                "memory_count": 0,
            }
        root = self.workspace_root_for(name)
        db = session_db_path(root)
        reasoning_rows = session_store.list_reasoning(db)
        reasoning: dict[str, dict[str, str]] = {
            r["turn_id"]: {
                "route_reason": r["route_reason"],
                "tool_plan": r["tool_plan"],
            }
            for r in reasoning_rows
        }
        return {
            "conversation_id": conversation_id,
            "workspace_dir": name,
            "paths": {
                "root": str(root),
                "output": str(output_dir(root)),
                "logs": str(root / "logs"),
                "runs": str(root / "runs"),
                "session_db": str(db),
            },
            "artifacts": session_store.list_artifacts(output_dir(root)),
            "tool_calls": session_store.list_tool_calls(db, limit=30),
            "reasoning": reasoning,
            "memory_count": len(session_store.list_messages(db, limit=200)),
        }
