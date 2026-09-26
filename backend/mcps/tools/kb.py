"""知识库存储层 — 工作区笔记索引 + 会话消息检索（向量可用时走 sqlite-vec）。

存储层被两处复用，保证「Agent 记的笔记」和「知识库管理页看到的文档」是同一份数据：
  - ``mcps.tools.kb``：Agent 侧工具（``kb_add_note`` / ``kb_search`` / ...）
  - ``knowledge`` 模块：知识库管理 REST API（列表 / 增删改 / 搜索 / 重建索引）

向量映射用 ``kb_vec_map`` 表（rowid -> doc_id）而非 JSON 文件：
JSON 文件的读改写不是原子的，并发写入可能丢映射；表与向量写入同库同事务、可随库备份。
旧的 ``kb.sqlite.rowid.json`` 仅作向后兼容的回退读取（旧索引升级后自动以表为准）。
"""

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

_MAX_HITS = 8


def kb_db_path() -> Path:
    return db.resolve_db_path().parent / "kb.sqlite"


def embed_dim() -> int:
    """当前向量模型的维度（切换模型后向量表按新维度重建）。"""
    return get_service().dimension


def ensure_kb() -> sqlite3.Connection:
    path = kb_db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    # WAL：管理页 / Agent 工具是跨请求多连接并发访问，WAL 允许读不阻塞写、
    # 写不互相阻塞（单写者），并把 busy_timeout 拉到 5s 吸收瞬时锁竞争。
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 5000")
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
    # rowid -> doc_id 的向量映射：与向量写入同库同事务，替代原先易竞态的 JSON 文件。
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS kb_vec_map (
            rowid INTEGER PRIMARY KEY,
            doc_id TEXT NOT NULL UNIQUE
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
            dim = embed_dim()
            # 模型维度变更时（如 384 -> 768）旧向量表维度不匹配，直接重建。
            # 索引数据可从 kb_docs 重新生成，不是唯一事实源；映射一并清空。
            row = conn.execute(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='kb_vec'"
            ).fetchone()
            if row and f"float[{dim}]" not in (row["sql"] or ""):
                conn.execute("DROP TABLE IF EXISTS kb_vec")
                conn.execute("DELETE FROM kb_vec_map")
            conn.execute(
                f"CREATE VIRTUAL TABLE IF NOT EXISTS kb_vec USING vec0(embedding float[{dim}])"
            )
            conn.commit()
        except Exception:  # noqa: BLE001 — 向量表可选
            pass
    return conn


def doc_id(title: str, content: str) -> str:
    """确定性 id：同一标题 + 内容哈希一致（Agent 笔记去重用）。"""
    raw = f"{title}\n{content}".encode("utf-8")
    return hashlib.sha256(raw).hexdigest()[:24]


def rowid_for(doc_id: str) -> int:
    """doc_id -> 稳定的正整数 rowid（向量表主键）。"""
    return int(doc_id[:8], 16) % (2**31 - 1)


def model_ready() -> bool:
    """向量模型已安装且 sqlite-vec 扩展可用（两者缺一都无法写向量）。"""
    return db.vec_available() and get_service().is_installed()


def _serialize(vec: list[float]) -> bytes:
    import sqlite_vec

    return sqlite_vec.serialize_float32(vec)


def _index_vec_row(
    conn: sqlite3.Connection, doc_id: str, text: str, svc: object
) -> bool:
    """把单篇文档向量写入 kb_vec + kb_vec_map，成功返回 True。"""
    try:
        vec = svc.embed_passages([text[:4000]])[0]
        if len(vec) != embed_dim():
            return False
        rowid = rowid_for(doc_id)
        blob = _serialize(vec)
        conn.execute("DELETE FROM kb_vec WHERE rowid=?", (rowid,))
        conn.execute("INSERT INTO kb_vec(rowid, embedding) VALUES (?, ?)", (rowid, blob))
        conn.execute(
            "INSERT OR REPLACE INTO kb_vec_map(rowid, doc_id) VALUES (?, ?)",
            (rowid, doc_id),
        )
        return True
    except Exception:  # noqa: BLE001 — 单个文档索引进度不影响主流程
        return False


def index_vec(conn: sqlite3.Connection, doc_id: str, text: str) -> None:
    """写单篇文档的向量（模型未就绪时静默跳过）。"""
    if not model_ready():
        return
    _index_vec_row(conn, doc_id, text, get_service())


def index_texts(conn: sqlite3.Connection, pairs: list[tuple[str, str]]) -> int:
    """批量索引 ``[(doc_id, text), ...]``；分块推理，返回成功条数。

    按 32 条一批喂给向量模型，避免文档极多时一次性 batch 撑爆内存。
    """
    if not pairs or not model_ready():
        return 0
    svc = get_service()
    indexed = 0
    for start in range(0, len(pairs), 32):
        chunk = pairs[start : start + 32]
        try:
            vecs = svc.embed_passages([text[:4000] for _, text in chunk])
        except Exception:  # noqa: BLE001 — 该批向量不可用时跳过，不整体失败
            continue
        for (doc_id, _), vec in zip(chunk, vecs):
            if len(vec) != embed_dim():
                continue
            try:
                rowid = rowid_for(doc_id)
                blob = _serialize(vec)
                conn.execute("DELETE FROM kb_vec WHERE rowid=?", (rowid,))
                conn.execute("INSERT INTO kb_vec(rowid, embedding) VALUES (?, ?)", (rowid, blob))
                conn.execute(
                    "INSERT OR REPLACE INTO kb_vec_map(rowid, doc_id) VALUES (?, ?)",
                    (rowid, doc_id),
                )
                indexed += 1
            except Exception:  # noqa: BLE001
                continue
    conn.commit()
    return indexed


def delete_vec(conn: sqlite3.Connection, doc_id: str) -> None:
    """删除某文档的向量与映射（幂等；向量表可能不存在）。"""
    rowid = rowid_for(doc_id)
    try:
        conn.execute("DELETE FROM kb_vec WHERE rowid=?", (rowid,))
    except Exception:  # noqa: BLE001
        pass
    try:
        conn.execute("DELETE FROM kb_vec_map WHERE doc_id=?", (doc_id,))
        conn.commit()
    except Exception:  # noqa: BLE001
        pass


def is_indexed(conn: sqlite3.Connection, doc_id: str) -> bool:
    """该文档当前是否已有向量（``indexed`` 状态用）。"""
    try:
        row = conn.execute(
            "SELECT 1 FROM kb_vec_map WHERE doc_id=?", (doc_id,)
        ).fetchone()
    except Exception:  # noqa: BLE001
        return False
    return row is not None


def _legacy_rowid_map() -> dict[str, str]:
    """旧版本 JSON 文件里的 rowid -> doc_id 映射（向后兼容回退读取）。"""
    path = kb_db_path().with_suffix(".rowid.json")
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:  # noqa: BLE001
        return {}


def _doc_row_to_hit(doc: sqlite3.Row, distance: float | None) -> dict[str, object]:
    return {
        "id": str(doc["id"]),
        "title": str(doc["title"]),
        "content": str(doc["content"]),
        "source": (str(doc["source"]) if doc["source"] else ""),
        "distance": distance,
    }


def _vec_hits(conn: sqlite3.Connection, query: str, limit: int) -> list[dict[str, object]]:
    """向量召回：返回 [{id,title,content,source,distance}]。"""
    if not model_ready():
        return []
    svc = get_service()
    try:
        qvec = svc.embed_query(query)
        blob = _serialize(qvec)
        rows = conn.execute(
            "SELECT rowid, distance FROM kb_vec WHERE embedding MATCH ? AND k = ? ORDER BY distance",
            (blob, limit),
        ).fetchall()
    except Exception:  # noqa: BLE001
        return []
    if not rows:
        return []
    # 映射优先读表；表为空（旧索引）时回退 JSON 文件。
    mapping: dict[int, str] = {}
    for r in conn.execute("SELECT rowid, doc_id FROM kb_vec_map").fetchall():
        mapping[int(r["rowid"])] = str(r["doc_id"])
    if not mapping:
        mapping = {int(k): str(v) for k, v in _legacy_rowid_map().items()}
    hits: list[dict[str, object]] = []
    for r in rows:
        doc_id = mapping.get(int(r["rowid"]))
        if not doc_id:
            continue
        doc = conn.execute(
            "SELECT id, title, content, source FROM kb_docs WHERE id=?", (doc_id,)
        ).fetchone()
        if not doc:
            continue
        hits.append(_doc_row_to_hit(doc, float(r["distance"])))
    return hits


def _like_hits(conn: sqlite3.Connection, query: str, limit: int) -> list[dict[str, object]]:
    """关键词（标题 / 正文子串）召回：返回 [{id,title,content,source,distance:None}]。"""
    like = f"%{query}%"
    rows = conn.execute(
        """
        SELECT id, title, content, source FROM kb_docs
        WHERE title LIKE ? OR content LIKE ?
        ORDER BY created_at DESC
        LIMIT ?
        """,
        (like, like, limit),
    ).fetchall()
    return [_doc_row_to_hit(doc, None) for doc in rows]


def _rrf_merge(
    vec_hits: list[dict[str, object]],
    like_hits: list[dict[str, object]],
    limit: int,
    k: int = 60,
) -> list[dict[str, object]]:
    """倒数排名融合（Reciprocal Rank Fusion）。

    把向量召回与关键词召回两个有序列表合并为一个更稳的排名，
    无需任何额外模型——这正是轻量级 rerank 的替代方案。
    同一条目在两路都命中时分数叠加，排名越靠前贡献越大。
    """
    scores: dict[str, float] = {}
    meta: dict[str, dict[str, object]] = {}
    for rank, h in enumerate(vec_hits):
        doc_id = str(h["id"])
        scores[doc_id] = scores.get(doc_id, 0.0) + 1.0 / (k + rank)
        # 向量命中优先保留其语义距离（distance 非 None）
        meta[doc_id] = {**h, "distance": h.get("distance")}
    for rank, h in enumerate(like_hits):
        doc_id = str(h["id"])
        scores[doc_id] = scores.get(doc_id, 0.0) + 1.0 / (k + rank)
        if doc_id not in meta:
            meta[doc_id] = {**h, "distance": None}
    ranked = sorted(scores.keys(), key=lambda d: scores[d], reverse=True)
    return [meta[d] for d in ranked[:limit]]


def search_hits(
    query: str, limit: int = 5, hybrid: bool = False
) -> list[dict[str, object]]:
    """检索本地知识库：优先向量召回，否则标题 / 正文子串匹配。

    返回结构化命中列表，供 Agent 工具与知识库管理 API 共同使用。
    模型未就绪时自动退化为关键词检索（不会抛错）。

    ``hybrid=True`` 时启用混合检索：向量召回与关键词召回双路候选，
    再用 RRF 融合排序，效果接近 rerank 但无需任何额外模型。
    """
    q = (query or "").strip()
    if not q:
        return []
    limit = max(1, min(int(limit), _MAX_HITS))
    with ensure_kb() as conn:
        if hybrid:
            candidate = max(limit * 4, 24)
            vec = _vec_hits(conn, q, candidate)
            like = _like_hits(conn, q, candidate)
            if vec or like:
                return _rrf_merge(vec, like, limit)
            return []
        hits = _vec_hits(conn, q, limit) or _like_hits(conn, q, limit)
    return hits


def format_hit(hit: dict[str, object]) -> str:
    """把一条结构化命中格式化为给 Agent 看的多行文本。"""
    snippet = re.sub(r"\s+", " ", str(hit["content"]))[:320]
    dist = hit.get("distance")
    prefix = (
        f"# {hit['title']} (dist={float(dist):.4f})" if dist is not None else f"# {hit['title']}"
    )
    return f"{prefix}\nsource={hit['source'] or '-'}\n{snippet}"


@tool
def kb_add_note(title: str, content: str, source: str = "") -> str:
    """把一条笔记写入本地知识库；若向量模型已就绪则同时写入向量索引。"""
    t = (title or "").strip() or "untitled"
    body = (content or "").strip()
    if not body:
        return "content 不能为空"
    doc_id = doc_id_for(t, body)
    try:
        with ensure_kb() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO kb_docs(id, title, content, source) VALUES (?,?,?,?)",
                (doc_id, t, body, (source or "").strip()),
            )
            conn.commit()
            index_vec(conn, doc_id, f"{t}\n{body}")
    except Exception as exc:  # noqa: BLE001
        return f"写入失败: {exc}"
    return f"ok id={doc_id} title={t}"


@tool
def kb_search(query: str, limit: int = 5) -> str:
    """检索本地知识库笔记；优先向量召回，否则标题/正文子串匹配。"""
    q = (query or "").strip()
    if not q:
        return "query 不能为空"
    try:
        hits = search_hits(q, limit=limit)
    except Exception as exc:  # noqa: BLE001
        return f"检索失败: {exc}"
    if not hits:
        return "知识库无命中"
    return "\n\n".join(format_hit(h) for h in hits)


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
    with ensure_kb() as conn:
        for fp in files[:100]:
            try:
                text = fp.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            if not text.strip():
                continue
            rel = fp.relative_to(root).as_posix()
            doc_id = doc_id_for(rel, text)
            conn.execute(
                "INSERT OR REPLACE INTO kb_docs(id, title, content, source) VALUES (?,?,?,?)",
                (doc_id, rel, text[:50_000], rel),
            )
            index_vec(conn, doc_id, text[:8_000])
            added += 1
        conn.commit()
    return f"ok indexed={added} glob={glob}"


def doc_id_for(title: str, content: str) -> str:
    """``kb_add_note`` / ``kb_index_workspace`` 用的确定性 id（别名，语义更清晰）。"""
    return doc_id(title, content)


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
