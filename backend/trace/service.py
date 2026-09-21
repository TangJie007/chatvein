"""追踪服务：开一轮记录、写会话库、按会话读取。"""

from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

from .recording import TraceRecorder, tracing
from .store import get_turn_trace, list_turn_traces, save_turn_trace


def _role_meta(role: dict[str, Any] | None) -> dict[str, Any]:
    if not role:
        return {}
    meta: dict[str, Any] = {
        "role_id": role.get("id"),
        "role_name": role.get("name"),
        "model_config_id": role.get("model_id"),
    }
    model_id = str(role.get("model_id") or "").strip()
    if not model_id:
        return meta
    try:
        from models.service import ModelsService  # pyright: ignore[reportMissingImports]

        entity = ModelsService().get_entity(model_id)
    except Exception:  # noqa: BLE001
        return meta
    if entity is None:
        return meta
    meta["model_name"] = entity.model_id
    meta["config_name"] = entity.name
    window_k = int(getattr(entity, "context_window_k", 0) or 0)
    if window_k:
        meta["context_window"] = window_k * 1000
    return meta


class TraceService:
    @contextmanager
    def recording(
        self,
        message: str,
        *,
        db_path: Path | None = None,
        turn_id: str | None = None,
        role: dict[str, Any] | None = None,
    ) -> Iterator[TraceRecorder]:
        """包住一轮对话。有库路径时，每完成一步就覆盖写入，结束前状态是 ``running``。"""

        def persist(payload: dict[str, Any]) -> None:
            if db_path is None or not turn_id:
                return
            try:
                save_turn_trace(db_path, turn_id, payload)
            except Exception as exc:  # noqa: BLE001
                print(f"CHATVEIN_TRACE save failed: {exc}", flush=True)

        with tracing(
            message,
            meta=_role_meta(role),
            on_change=persist if db_path is not None and turn_id else None,
        ) as recorder:
            yield recorder

    def list_traces(self, conversation_id: str) -> list[dict[str, Any]] | None:
        """会话不存在时返回 ``None``。"""
        db = self._session_db(conversation_id)
        if db is None:
            return None
        return list_turn_traces(db)

    def get_trace(self, conversation_id: str, turn_id: str) -> dict[str, Any] | None:
        db = self._session_db(conversation_id)
        if db is None:
            return None
        return get_turn_trace(db, turn_id)

    def _session_db(self, conversation_id: str) -> Path | None:
        from conversations.service import ConversationsService  # pyright: ignore[reportMissingImports]
        from mcps.sandbox import session_db_path  # pyright: ignore[reportMissingImports]

        conversation = ConversationsService().get_conversation(conversation_id)
        if conversation is None:
            return None
        name = str(conversation.get("workspace_dir") or "").strip()
        if not name:
            return None
        root = ConversationsService().workspace_root_for(name)
        return session_db_path(root)
