"""知识库工具 — 工作区笔记索引 + 会话消息检索（向量可用时走 sqlite-vec）。"""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from pathlib import Path

from langchain_core.tools import BaseTool, tool

import db  # pyright: ignore[reportImplicitRelativeImport]
from embeddings.service import get_service  # pyright: ignore[reportImplicitRelativeImport]
from mcps.sandbox import current_sandbox  # pyright: ignore[reportImplicitRelativeImport]

_DIM = 384
_MAX_HITS = 8


def _kb_db_path() -> Path:
    return db.resolve_db_path().parent / "kb.sqlite"


def _ensure_kb() -> sqlite3.Connection:
    path = _kb_db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS kb_docs (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            source TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
        """
    )
    conn.commit()
    if db.vec_available():
        try:
            conn.enable_load_extension(True)
            import sqlite_vec

            sqlite_vec.load(conn)
            conn.enable_load_extension(False)
            conn.execute(
                f"CREATE VIRTUAL TABLE IF NOT EXISTS kb_vec USING vec0(embedding float[{_DIM}])"
            )
            conn.commit()
        except Exception:  # noqa: BLE001 — 向量表可选
            pass
    return conn


def _doc_id(title: str, content: str) -> str:
    raw = f"{title}\n{content}".encode("utf-8")
    return hashlib.sha256(raw).hexdigest()[:24]


@tool
def kb_add_note(title: str, content: str, source: str = "") -> str:
    """把一条笔记写入本地知识库；若向量模型已就绪则同时写入向量索引。"""
    t = (title or "").strip() or "untitled"
    body = (content or "").strip()
    if not body:
        return "content 不能为空"
    doc_id = _doc_id(t, body)
    try:
        with _ensure_kb() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO kb_docs(id, title, content, source) VALUES (?,?,?,?)",
                (doc_id, t, body, (source or "").strip()),
            )
            conn.commit()
            _try_index_vec(conn, doc_id, f"{t}\n{body}")
    except Exception as exc:  # noqa: BLE001
        return f"写入失败: {exc}"
    return f"ok id={doc_id} title={t}"


@tool
def kb_search(query: str, limit: int = 5) -> str:
    """检索本地知识库笔记；优先向量召回，否则标题/正文子串匹配。"""
    q = (query or "").strip()
    if not q:
        return "query 不能为空"
    limit = max(1, min(int(limit), _MAX_HITS))
    try:
        with _ensure_kb() as conn:
            hits = _vec_search(conn, q, limit) or _like_search(conn, q, limit)
    except Exception as exc:  # noqa: BLE001
        return f"检索失败: {exc}"
    if not hits:
        return "知识库无命中"
    return "\n\n".join(hits)


@tool
def kb_search_messages(query: str, limit: int = 5) -> str:
    """在历史会话消息中按关键词检索（LIKE），用于回忆过往对话。"""
    q = (query or "").strip()
    if not q:
        return "query 不能为空"
    limit = max(1, min(int(limit), _MAX_HITS))
    try:
        from conversations.service import ConversationsService  # pyright: ignore[reportImplicitRelativeImport]
        from conversations import session_store  # pyright: ignore[reportImplicitRelativeImport]
        from mcps.sandbox import session_db_path  # pyright: ignore[reportImplicitRelativeImport]

        service = ConversationsService()
        hits: list[str] = []
        for conv in service.list_conversations(limit=200):
            if len(hits) >= limit:
                break
            name = (conv.get("workspace_dir") or "").strip()
            if not name:
                continue
            try:
                db = session_db_path(service.workspace_root_for(name))
                rows = session_store.list_messages(db, limit=200)
            except Exception:
                continue
            for m in reversed(rows):
                content = str(m.get("content") or "")
                if q.lower() not in content.lower():
                    continue
                snippet = re.sub(r"\s+", " ", content)[:240]
                hits.append(
                    f"[{m.get('created_at')}] {m.get('role')} conv={conv['id']}\n{snippet}"
                )
                if len(hits) >= limit:
                    break
    except Exception as exc:  # noqa: BLE001
        return f"消息检索失败: {exc}"
    if not hits:
        return "历史消息无命中"
    return "\n\n".join(hits)


@tool
def kb_index_workspace(glob: str = "**/*.md") -> str:
    """把当前会话工作区内匹配的文本文件批量写入知识库（便于后续 kb_search）。"""
    try:
        root = current_sandbox()
    except ValueError as exc:
        return str(exc)
    files = [p for p in root.glob(glob or "**/*.md") if p.is_file()]
    if not files:
        return "会话工作区无匹配文件"
    added = 0
    with _ensure_kb() as conn:
        for fp in files[:100]:
            try:
                text = fp.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            if not text.strip():
                continue
            rel = fp.relative_to(root).as_posix()
            doc_id = _doc_id(rel, text)
            conn.execute(
                "INSERT OR REPLACE INTO kb_docs(id, title, content, source) VALUES (?,?,?,?)",
                (doc_id, rel, text[:50_000], rel),
            )
            _try_index_vec(conn, doc_id, text[:8_000])
            added += 1
        conn.commit()
    return f"ok indexed={added} glob={glob}"


def _try_index_vec(conn: sqlite3.Connection, doc_id: str, text: str) -> None:
    svc = get_service()
    if not svc.is_installed() or not db.vec_available():
        return
    try:
        vec = svc.embed_passages([text[:4000]])[0]
        if len(vec) != _DIM:
            return
        # rowid 用 doc 哈希的稳定整数
        rowid = int(doc_id[:8], 16) % (2**31 - 1)
        blob = _serialize(vec)
        conn.execute("DELETE FROM kb_vec WHERE rowid=?", (rowid,))
        conn.execute("INSERT INTO kb_vec(rowid, embedding) VALUES (?, ?)", (rowid, blob))
        # 把 rowid 映射存进 docs 的 source 旁：用临时表太重，这里把映射放 metadata JSON 文件
        _rowid_map_path().write_text(
            json.dumps({**_load_rowid_map(), str(rowid): doc_id}, ensure_ascii=False),
            encoding="utf-8",
        )
    except Exception:  # noqa: BLE001
        return


def _serialize(vec: list[float]) -> bytes:
    import sqlite_vec

    return sqlite_vec.serialize_float32(vec)


def _rowid_map_path() -> Path:
    return _kb_db_path().with_suffix(".rowid.json")


def _load_rowid_map() -> dict[str, str]:
    path = _rowid_map_path()
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:  # noqa: BLE001
        return {}


def _vec_search(conn: sqlite3.Connection, query: str, limit: int) -> list[str]:
    svc = get_service()
    if not svc.is_installed() or not db.vec_available():
        return []
    try:
        qvec = svc.embed_query(query)
        blob = _serialize(qvec)
        rows = conn.execute(
            "SELECT rowid, distance FROM kb_vec WHERE embedding MATCH ? AND k = ? ORDER BY distance",
            (blob, limit),
        ).fetchall()
    except Exception:  # noqa: BLE001
        return []
    mapping = _load_rowid_map()
    hits: list[str] = []
    for r in rows:
        doc_id = mapping.get(str(r["rowid"]))
        if not doc_id:
            continue
        doc = conn.execute(
            "SELECT title, content, source FROM kb_docs WHERE id=?", (doc_id,)
        ).fetchone()
        if not doc:
            continue
        snippet = re.sub(r"\s+", " ", str(doc["content"]))[:320]
        hits.append(
            f"# {doc['title']} (dist={float(r['distance']):.4f})\nsource={doc['source'] or '-'}\n{snippet}"
        )
    return hits


def _like_search(conn: sqlite3.Connection, query: str, limit: int) -> list[str]:
    like = f"%{query}%"
    rows = conn.execute(
        """
        SELECT title, content, source FROM kb_docs
        WHERE title LIKE ? OR content LIKE ?
        ORDER BY created_at DESC
        LIMIT ?
        """,
        (like, like, limit),
    ).fetchall()
    hits: list[str] = []
    for doc in rows:
        snippet = re.sub(r"\s+", " ", str(doc["content"]))[:320]
        hits.append(f"# {doc['title']}\nsource={doc['source'] or '-'}\n{snippet}")
    return hits


TOOLS: tuple[BaseTool, ...] = (
    kb_add_note,
    kb_search,
    kb_search_messages,
    kb_index_workspace,
)


def heuristic(text: str) -> list[str]:
    names: list[str] = []
    if any(k in text for k in ("记一下", "写入知识库", "存笔记", "kb add")):
        names.append("kb_add_note")
    if any(k in text for k in ("知识库", "笔记里", "kb search", "查笔记")):
        names.append("kb_search")
    if any(k in text for k in ("以前聊过", "历史消息", "回忆", "会话里搜")):
        names.append("kb_search_messages")
    if any(k in text for k in ("索引工作区", "index workspace", "把 md 入库")):
        names.append("kb_index_workspace")
    return names
