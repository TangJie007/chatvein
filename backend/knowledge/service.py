"""知识库管理服务：状态 / 列表 / 详情 / 增删改 / 搜索 / 批量导入 / 重建索引。

与 ``mcps.tools.kb`` 共用同一份 ``kb.sqlite`` 存储与向量索引函数：
Agent 对话里「记一条笔记」和知识库管理页看到的文档是同一份数据。
所有会写向量的操作（创建 / 更新 / 删除 / 清空 / 导入 / 重建）用进程内锁串行化，
避免多个请求并发写 sqlite-vec 与映射表时的竞态（WAL + busy_timeout 兜底锁等待）。
"""

from __future__ import annotations

import sqlite3
import threading
import uuid
from typing import Any

from embeddings.service import get_service as get_embedding_service  # pyright: ignore[reportImplicitRelativeImport]
from mcps.tools import kb as store  # pyright: ignore[reportImplicitRelativeImport]

from .entity.dto import KbCreateIn, KbImportIn, KbUpdateIn


class KnowledgeService:
    def __init__(self) -> None:
        self._index_lock = threading.Lock()

    # ---- 状态 ----
    def status(self) -> dict[str, Any]:
        """知识库概况：文档数 / 已索引数 / 向量可用性 / 存储路径。"""
        path = store.kb_db_path()
        count = 0
        indexed = 0
        try:
            with store.ensure_kb() as conn:
                count = int(conn.execute("SELECT count(*) FROM kb_docs").fetchone()[0])
                indexed = int(
                    conn.execute("SELECT count(*) FROM kb_vec_map").fetchone()[0]
                )
        except sqlite3.OperationalError:  # 库还没初始化：按 0 条展示
            pass
        embed = get_embedding_service()
        return {
            "db_path": str(path),
            "count": count,
            "indexed": indexed,
            "vec_ready": store.model_ready(),
            "model": embed.model_name,
            "model_installed": embed.is_installed(),
            "dim": embed.dimension,
        }

    # ---- 列表 / 详情 ----
    def list_docs(self, q: str = "", limit: int = 50, offset: int = 0) -> dict[str, Any]:
        limit = max(1, min(int(limit), 200))
        offset = max(0, int(offset))
        keyword = (q or "").strip()
        with store.ensure_kb() as conn:
            if keyword:
                like = f"%{keyword}%"
                total = int(
                    conn.execute(
                        "SELECT count(*) FROM kb_docs WHERE title LIKE ? OR content LIKE ?",
                        (like, like),
                    ).fetchone()[0]
                )
                rows = conn.execute(
                    """
                    SELECT id, title, content, source, created_at FROM kb_docs
                    WHERE title LIKE ? OR content LIKE ?
                    ORDER BY created_at DESC
                    LIMIT ? OFFSET ?
                    """,
                    (like, like, limit, offset),
                ).fetchall()
            else:
                total = int(conn.execute("SELECT count(*) FROM kb_docs").fetchone()[0])
                rows = conn.execute(
                    """
                    SELECT id, title, content, source, created_at FROM kb_docs
                    ORDER BY created_at DESC
                    LIMIT ? OFFSET ?
                    """,
                    (limit, offset),
                ).fetchall()
            items = [self._row_to_dto(conn, r) for r in rows]
        return {"total": total, "items": items, "limit": limit, "offset": offset}

    def get_doc(self, doc_id: str) -> dict[str, Any]:
        with store.ensure_kb() as conn:
            row = self._find(conn, doc_id)
            if row is None:
                raise KeyError("文档不存在")
            return self._row_to_dto(conn, row)

    # ---- 写入 ----
    def create_doc(self, payload: KbCreateIn) -> dict[str, Any]:
        title = (payload.title or "").strip() or "untitled"
        content = (payload.content or "").strip()
        source = (payload.source or "").strip()
        if not content:
            raise ValueError("content 不能为空")
        doc_id = uuid.uuid4().hex
        with self._index_lock:
            with store.ensure_kb() as conn:
                conn.execute(
                    "INSERT INTO kb_docs(id, title, content, source) VALUES (?,?,?,?)",
                    (doc_id, title, content, source),
                )
                conn.commit()
                store.index_vec(conn, doc_id, f"{title}\n{content}")
                row = self._find(conn, doc_id)
                return self._row_to_dto(conn, row)

    def update_doc(self, doc_id: str, payload: KbUpdateIn) -> dict[str, Any]:
        with self._index_lock:
            with store.ensure_kb() as conn:
                row = self._find(conn, doc_id)
                if row is None:
                    raise KeyError("文档不存在")
                new_title = (
                    (payload.title or "").strip()
                    if payload.title is not None
                    else str(row["title"])
                ) or "untitled"
                new_content = (
                    (payload.content or "").strip()
                    if payload.content is not None
                    else str(row["content"])
                )
                if not new_content:
                    raise ValueError("content 不能为空")
                new_source = (
                    (payload.source or "").strip()
                    if payload.source is not None
                    else (str(row["source"]) if row["source"] else "")
                )
                conn.execute(
                    "UPDATE kb_docs SET title=?, content=?, source=? WHERE id=?",
                    (new_title, new_content, new_source, doc_id),
                )
                conn.commit()
                # 内容变更后旧向量作废：重新写入同 rowid（id 不变）。
                store.delete_vec(conn, doc_id)
                store.index_vec(conn, doc_id, f"{new_title}\n{new_content}")
                row = self._find(conn, doc_id)
                return self._row_to_dto(conn, row)

    def delete_doc(self, doc_id: str) -> dict[str, Any]:
        with self._index_lock:
            with store.ensure_kb() as conn:
                row = self._find(conn, doc_id)
                if row is None:
                    raise KeyError("文档不存在")
                conn.execute("DELETE FROM kb_docs WHERE id=?", (doc_id,))
                conn.commit()
                store.delete_vec(conn, doc_id)
                return {"deleted": doc_id}

    def clear(self) -> dict[str, Any]:
        with self._index_lock:
            with store.ensure_kb() as conn:
                deleted = int(conn.execute("SELECT count(*) FROM kb_docs").fetchone()[0])
                conn.execute("DELETE FROM kb_docs")
                try:
                    conn.execute("DELETE FROM kb_vec")
                except sqlite3.OperationalError:  # 向量表未创建时跳过
                    pass
                conn.execute("DELETE FROM kb_vec_map")
                conn.commit()
                return {"deleted": deleted}

    # ---- 搜索 ----
    def search(self, query: str, limit: int = 5, hybrid: bool = False) -> list[dict[str, Any]]:
        hits = store.search_hits(query, limit=limit, hybrid=hybrid)
        for hit in hits:
            hit["indexed"] = True if hit.get("distance") is not None else False
            hit["char_count"] = len(str(hit["content"]))
        return hits

    # ---- 批量导入 / 重建索引 ----
    def import_items(self, payload: KbImportIn) -> dict[str, Any]:
        created = 0
        pairs: list[tuple[str, str]] = []
        with self._index_lock:
            with store.ensure_kb() as conn:
                for item in payload.items:
                    title = (item.title or "").strip() or "untitled"
                    content = (item.content or "").strip()
                    source = (item.source or "").strip()
                    if not content:
                        continue
                    doc_id = uuid.uuid4().hex
                    conn.execute(
                        "INSERT INTO kb_docs(id, title, content, source) VALUES (?,?,?,?)",
                        (doc_id, title, content, source),
                    )
                    pairs.append((doc_id, f"{title}\n{content}"))
                    created += 1
                conn.commit()
                indexed = store.index_texts(conn, pairs)
        return {"created": created, "indexed": indexed}

    def rebuild_index(self) -> dict[str, Any]:
        if not store.model_ready():
            raise ValueError("向量模型未就绪，无法重建索引")
        with self._index_lock:
            with store.ensure_kb() as conn:
                rows = conn.execute(
                    "SELECT id, title, content FROM kb_docs"
                ).fetchall()
                total = len(rows)
                if not total:
                    return {"total": 0, "indexed": 0}
                # 全量重建：清空旧向量，再从 kb_docs 逐批重新向量化。
                try:
                    conn.execute("DELETE FROM kb_vec")
                except sqlite3.OperationalError:  # 向量表未创建时跳过
                    pass
                conn.execute("DELETE FROM kb_vec_map")
                conn.commit()
                pairs = [
                    (str(r["id"]), f"{str(r['title'])}\n{str(r['content'])}")
                    for r in rows
                ]
                indexed = store.index_texts(conn, pairs)
                return {"total": total, "indexed": indexed}

    # ---- 内部 ----
    def _find(self, conn: Any, doc_id: str) -> Any:
        return conn.execute(
            "SELECT id, title, content, source, created_at FROM kb_docs WHERE id=?",
            (doc_id,),
        ).fetchone()

    def _row_to_dto(self, conn: Any, row: Any) -> dict[str, Any]:
        created = str(row["created_at"] or "").replace(" ", "T") + ("Z" if row["created_at"] else "")
        return {
            "id": str(row["id"]),
            "title": str(row["title"]),
            "content": str(row["content"]),
            "source": (str(row["source"]) if row["source"] else ""),
            "created_at": created,
            "indexed": store.is_indexed(conn, str(row["id"])),
            "char_count": len(str(row["content"])),
        }


_service: KnowledgeService | None = None
_service_lock = threading.Lock()


def get_service() -> KnowledgeService:
    """进程内单例。"""
    global _service
    if _service is None:
        with _service_lock:
            if _service is None:
                _service = KnowledgeService()
    return _service
