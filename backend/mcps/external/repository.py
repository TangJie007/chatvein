"""``mcp_servers`` 表读写（主库，仅本模块使用）。

刻意用裸 SQL 而不建 SQLModel 实体：这张表只有「列几行 / 改一行」两种访问，
不值得为它注册实体；同时避免 ``db.register_entities`` 与 ``mcps`` 包互相 import。
"""

from __future__ import annotations

from typing import Any, Iterable

from sqlalchemy import text

import db  # pyright: ignore[reportImplicitRelativeImport]


_COLUMNS = (
    "id",
    "name",
    "transport",
    "command",
    "url",
    "env_enc",
    "headers_enc",
    "allow_tools",
    "approval_mode",
    "enabled",
    "timeout_s",
    "created_at",
    "updated_at",
)


def list_rows() -> list[dict[str, Any]]:
    with db.session_scope() as session:
        rows = session.execute(text("SELECT * FROM mcp_servers ORDER BY name, id")).mappings().all()
    return [dict(row) for row in rows]


def get_row(server_id: str) -> dict[str, Any] | None:
    with db.session_scope() as session:
        row = (
            session.execute(
                text("SELECT * FROM mcp_servers WHERE id = :id"), {"id": server_id}
            )
            .mappings()
            .first()
        )
    return dict(row) if row else None


def insert_row(fields: dict[str, Any]) -> dict[str, Any]:
    now = db.iso(db.utc_now())
    row = {key: fields.get(key) for key in _COLUMNS}
    row["created_at"] = now
    row["updated_at"] = now
    placeholders = ", ".join(f":{key}" for key in _COLUMNS)
    with db.session_scope() as session:
        session.execute(
            text(f"INSERT INTO mcp_servers ({', '.join(_COLUMNS)}) VALUES ({placeholders})"),
            row,
        )
    return row


def update_row(server_id: str, fields: dict[str, Any]) -> dict[str, Any] | None:
    allowed: Iterable[str] = [key for key in _COLUMNS if key in fields]
    keys = list(allowed)
    if not keys:
        return get_row(server_id)
    params = {key: fields[key] for key in keys}
    params["updated_at"] = db.iso(db.utc_now())
    assignments = ", ".join(f"{key} = :{key}" for key in [*keys, "updated_at"])
    with db.session_scope() as session:
        result = session.execute(
            text(f"UPDATE mcp_servers SET {assignments} WHERE id = :id"),
            {**params, "id": server_id},
        )
    if not getattr(result, "rowcount", 0):
        return None
    return get_row(server_id)


def delete_row(server_id: str) -> bool:
    with db.session_scope() as session:
        result = session.execute(
            text("DELETE FROM mcp_servers WHERE id = :id"), {"id": server_id}
        )
    return bool(getattr(result, "rowcount", 0))


__all__ = ["delete_row", "get_row", "insert_row", "list_rows", "update_row"]
