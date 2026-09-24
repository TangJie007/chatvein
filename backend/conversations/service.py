"""会话业务逻辑：元数据在主库，消息只在会话空间 session.sqlite。"""

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
        rows = self._repo.list(limit)
        enriched: list[ConversationRecord] = []
        for row in rows:
            count, last = self._session_preview(row)
            enriched.append(
                ConversationRecord(
                    id=row["id"],
                    title=row["title"],
                    workspace_dir=row["workspace_dir"],
                    created_at=row["created_at"],
                    updated_at=row["updated_at"],
                    message_count=count,
                    last_message=last,
                    skills=row.get("skills") or [],
                )
            )
        return enriched

    def create_conversation(self, dto: CreateConversationDto) -> ConversationRecord:
        return self._repo.create(dto.title)

    def get_conversation(self, conversation_id: str) -> ConversationRecord | None:
        row = self._repo.get(conversation_id)
        if row is None:
            return None
        count, last = self._session_preview(row)
        return ConversationRecord(
            id=row["id"],
            title=row["title"],
            workspace_dir=row["workspace_dir"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            message_count=count,
            last_message=last,
            skills=row.get("skills") or [],
        )

    def delete_conversation(self, conversation_id: str) -> bool:
        return self._repo.delete(conversation_id)

    def clear_conversations(self) -> int:
        return self._repo.clear()

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

    def _session_preview(self, row: ConversationRecord) -> tuple[int, str | None]:
        name = (row.get("workspace_dir") or "").strip()
        if not name:
            return 0, None
        try:
            db = session_db_path(self.workspace_root_for(name))
            return session_store.preview(db)
        except Exception:
            return 0, None

    def _to_message_record(
        self, conversation_id: str, row: dict[str, Any]
    ) -> MessageRecord:
        return MessageRecord(
            id=int(row["id"]),
            conversation_id=conversation_id,
            role=str(row["role"]),
            content=str(row["content"]),
            used_llm=bool(row.get("used_llm")),
            route=row.get("route"),
            created_at=str(row.get("created_at") or ""),
            turn_id=str(row.get("turn_id") or ""),
            tokens=int(row.get("tokens") or 0),
            duration_ms=int(row.get("duration_ms") or 0),
        )

    def _trace_metrics_by_turn(self, db_path: Path) -> dict[str, tuple[int, int]]:
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

    def list_messages(self, conversation_id: str) -> list[MessageRecord]:
        """UI 历史：只读会话空间库，缺 tokens/耗时时从 turn_traces 补全。"""
        db = self._session_db_for(conversation_id)
        if db is None:
            return []
        try:
            rows = session_store.list_messages(db, limit=500)
        except Exception:
            return []
        need = [
            r
            for r in rows
            if r.get("role") == "assistant"
            and (r.get("turn_id") or "").strip()
            and (not int(r.get("tokens") or 0) or not int(r.get("duration_ms") or 0))
        ]
        if need:
            metrics = self._trace_metrics_by_turn(db)
            updates = {
                str(r["turn_id"]): metrics[str(r["turn_id"])]
                for r in need
                if str(r.get("turn_id") or "") in metrics
            }
            if updates:
                session_store.apply_turn_metrics(db, updates)
                rows = session_store.list_messages(db, limit=500)
        return [self._to_message_record(conversation_id, r) for r in rows]

    def delete_last_exchange(
        self,
        conversation_id: str,
        *,
        user_content: str | None = None,
        after_message_id: int | None = None,
    ) -> int:
        """撤回 / 停止：只删会话空间本轮（带原文 + baseline id 防护）。"""
        db = self._session_db_for(conversation_id)
        if db is None:
            return 0
        try:
            removed = session_store.delete_last_exchange(
                db,
                user_content=user_content,
                after_message_id=after_message_id,
            )
        except Exception:
            return 0
        if removed > 0:
            # 刷新主库 updated_at，便于列表排序
            conversation = self._repo.get(conversation_id)
            if conversation is not None:
                self._repo.touch_exchange(
                    conversation_id,
                    title_hint=conversation.get("title") or "会话",
                )
        return removed

    def open_for_chat(self, conversation_id: str | None, title_hint: str) -> ConversationRecord:
        return self._repo.open_for_chat(conversation_id, title_hint)

    def set_conversation_skills(self, conversation_id: str, skills: list[str] | None) -> list[str]:
        """覆盖会话级技能集（Composer 勾选 / 移除时即时持久化）。"""
        return self._repo.set_skills(conversation_id, skills)

    def get_conversation_skills(self, conversation_id: str) -> list[str]:
        return self._repo.get_skills(conversation_id)

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
        tool_trace: list[dict[str, Any]] | None = None,
        route_reason: str | None = None,
        tool_plan: str | None = None,
        actor_id: str | None = None,
        # 群里 @ 多人时同一句提问只落一次：后续轮次传 False，只写助手回复。
        append_user: bool = True,
    ) -> tuple[str, MessageRecord, MessageRecord]:
        """更新会话元数据，并把本轮消息写入会话空间库。"""
        hint = title_hint or user_text
        conversation = self._repo.touch_exchange(conversation_id, title_hint=hint)
        cid = conversation["id"]
        workspace_dir = conversation["workspace_dir"]
        turn_id = turn_id or uuid.uuid4().hex
        root = self.workspace_root_for(workspace_dir)
        db = session_db_path(root)
        user_id = (
            session_store.append_message(
                db, "user", user_text, route=route, actor_id=actor_id
            )
            if append_user
            else None
        )
        assistant_id = session_store.append_message(
            db,
            "assistant",
            reply_text,
            route=route,
            used_llm=used_llm,
            turn_id=turn_id,
            route_reason=route_reason,
            tool_plan=tool_plan,
            tokens=tokens,
            duration_ms=duration_ms,
            actor_id=actor_id,
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
        now = ""
        user_msg = MessageRecord(
            # 未落用户消息时（群里 @ 多人的后续轮次）用 0 表示「本轮没有新的用户消息」
            id=user_id or 0,
            conversation_id=cid,
            role="user",
            content=user_text,
            used_llm=False,
            route=route,
            created_at=now,
            turn_id="",
            tokens=0,
            duration_ms=0,
            actor_id=actor_id,
        )
        assistant_msg = MessageRecord(
            id=assistant_id,
            conversation_id=cid,
            role="assistant",
            content=reply_text,
            used_llm=used_llm,
            route=route,
            created_at=now,
            turn_id=turn_id,
            tokens=int(tokens or 0),
            duration_ms=int(duration_ms or 0),
            actor_id=actor_id,
        )
        return cid, user_msg, assistant_msg

    def counts(self) -> dict[str, int]:
        base = self._repo.counts()
        # 设置页「消息数」改为各会话空间合计
        total = 0
        for row in self._repo.list(limit=10_000):
            count, _ = self._session_preview(row)
            total += count
        return {"conversations": base["conversations"], "messages": total}

    def workspace_root_for(self, workspace_dir: str) -> Path:
        return init_conversation_layout(conversation_root(workspace_dir))

    def short_term_memory(
        self,
        workspace_dir: str,
        *,
        conversation_id: str | None = None,
        limit: int = 24,
    ) -> list[dict[str, Any]]:
        """从会话 ``logs/session.sqlite`` 读取短期记忆。"""
        _ = conversation_id
        db = session_db_path(self.workspace_root_for(workspace_dir))
        return session_store.list_messages(db, limit=limit)

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
        tokens: int = 0,
        duration_ms: int = 0,
    ) -> None:
        """写入会话库：消息 + 本轮工具轨迹 + 本轮推理。"""
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
            tokens=tokens,
            duration_ms=duration_ms,
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

    def open_artifact_location(self, conversation_id: str, path: str | None) -> str | None:
        """在系统文件管理器中打开产物所在目录。

        仅当 ``path`` 位于该会话工作区内时才允许，避免越权打开任意路径。
        """
        conversation = self._repo.get(conversation_id)
        if conversation is None:
            return None
        name = (conversation.get("workspace_dir") or "").strip()
        if not name or not path:
            return None
        root = self.workspace_root_for(name).resolve()
        target = Path(path).resolve()
        try:
            target.relative_to(root)
        except ValueError:
            return None
        from mcps.tools.fs import _open_in_file_manager  # pyright: ignore[reportImplicitRelativeImport]

        folder = (
            target.parent
            if target.is_file()
            else target
            if target.is_dir()
            else root
        )
        _open_in_file_manager(str(folder))
        return str(folder)

    def workspace_insight(self, conversation_id: str) -> dict[str, Any] | None:
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


# re-export
__all__ = ["ConversationsService"]
