"""工具选型的两阶段预筛：向量相似度 + BM25 召回 top-k，再由模型精选。

设计要点：
- **离线优先**：BM25 走 ``bm25s``（纯 Python，无需下载，始终可用）；向量模型
  （fastembed）需先下载，未就绪时自动退化为 BM25-only，不阻塞选型。
- **融合用 RRF**（Reciprocal Rank Fusion）：把向量、BM25 两套排名按名次融合，
  不依赖分数量纲，对两类检索都稳健，也避免某一侧分数尺度过大压垮另一侧。
- **索引懒构建 + 进程内缓存**：工具注册表不变就只建一次 BM25 / 向量，避免每轮
  对话重复分词与推理。
- 预筛只收窄「交给模型的候选池」，未经筛选的工具不进入模型可见清单；若预筛
  失败则回落到前 ``top_k`` 个，绝不返回空池（除非本就无工具）。
"""

from __future__ import annotations

import os
import threading
from typing import Iterable, Sequence

import bm25s

from mcps.registry import all_tools  # pyright: ignore[reportImplicitRelativeImport]

_TOPK_ENV = "CHATVEIN_TOOL_PREFILTER_TOPK"
_ENABLED_ENV = "CHATVEIN_TOOL_PREFILTER"

# bm25s 默认 token_pattern 是 ``\w\w+``，会把单字中文整段丢掉的；这里自定义为
# 「CJK 单字」或「拉丁/数字连续串」，让中文也能逐字命中。
_TOKEN_PATTERN = r"[\u3400-\u9fff\uff00-\uffef]|[A-Za-z0-9]+"


def _env_int(name: str, default: int) -> int:
    raw = (os.environ.get(name) or "").strip()
    try:
        return int(raw) if raw else default
    except ValueError:
        return default


def prefilter_enabled() -> bool:
    return (os.environ.get(_ENABLED_ENV) or "1").strip() not in (
        "0",
        "false",
        "no",
        "off",
    )


def _tokenize(texts: Sequence[str]):
    # return_ids=False → 返回纯 list[list[str]]；bm25s 0.3 的 get_scores
    # 不接受 Tokenized 对象（index 能接受，但 get_scores 会报 must be a list）。
    return bm25s.tokenize(
        list(texts),
        token_pattern=_TOKEN_PATTERN,
        stopwords=None,
        return_ids=False,
        show_progress=False,
    )


class ToolRetriever:
    """在工具注册表上建一份可复用的混合索引，按查询召回 top-k 工具名。"""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._names: list[str] = []
        self._docs: list[str] = []
        self._bm25: object | None = None
        self._embeddings: list[list[float]] | None = None

    def _build(self) -> None:
        tools = all_tools()
        self._names = [t.name for t in tools]
        # 文档 = 工具名 + 分组 + 描述，三者都对召回有帮助
        self._docs = [
            f"{t.name} {getattr(t, 'group', '') or ''} {t.description or ''}"
            for t in tools
        ]
        corpus = _tokenize(self._docs)
        self._bm25 = bm25s.BM25()
        self._bm25.index(corpus)  # type: ignore[attr-defined]
        self._embeddings = None
        # 向量：未下载则跳过，退化为 BM25-only（不影响 BM25 召回）
        try:
            from embeddings.service import get_service  # 延迟导入，避免循环依赖

            svc = get_service()
            if svc.is_installed():
                self._embeddings = svc.embed_passages(self._docs)
        except Exception:  # noqa: BLE001 — 向量不可用时不影响 BM25 召回
            self._embeddings = None

    def _ensure_built(self) -> None:
        with self._lock:
            if self._bm25 is None:
                self._build()

    def retrieve(self, query: str, top_k: int) -> list[str]:
        self._ensure_built()
        if not self._names:
            return []
        assert self._bm25 is not None
        # get_scores 接收「单个查询」的 token 扁平列表（List[str]），故取 [0]
        bm25_scores = self._bm25.get_scores(_tokenize([query])[0])  # type: ignore[attr-defined]

        vec_scores: list[float] | None = None
        if self._embeddings is not None:
            try:
                from embeddings.service import get_service

                qv = get_service().embed_query(query)
                vec_scores = [_cosine(qv, e) for e in self._embeddings]
            except Exception:  # noqa: BLE001
                vec_scores = None

        fused = _rrf(bm25_scores, vec_scores)
        order = sorted(range(len(self._names)), key=lambda i: fused[i], reverse=True)
        return [self._names[i] for i in order[:top_k]]


def _cosine(a: Sequence[float], b: Sequence[float]) -> float:
    if not a or not b:
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(x * x for x in b) ** 0.5
    return dot / (na * nb) if na and nb else 0.0


def _rrf(*score_lists: Sequence[float] | None, k: int = 60) -> list[float]:
    """Reciprocal Rank Fusion：把多路检索按名次融合，不依赖原分数量纲。"""
    n = 0
    for s in score_lists:
        if s is not None:
            n = len(s)
            break
    fused = [0.0] * n
    for scores in score_lists:
        if scores is None:
            continue
        ranked = sorted(range(n), key=lambda i: scores[i], reverse=True)
        for rank, idx in enumerate(ranked):
            fused[idx] += 1.0 / (k + rank + 1)
    return fused


_retriever: ToolRetriever | None = None
_retriever_lock = threading.Lock()


def get_retriever() -> ToolRetriever:
    global _retriever
    if _retriever is None:
        with _retriever_lock:
            if _retriever is None:
                _retriever = ToolRetriever()
    return _retriever


def prefilter_tools(
    query: str,
    tools: Iterable[object],
    *,
    top_k: int | None = None,
) -> list[object]:
    """用「向量 + BM25」预筛，返回 ``tools`` 中相关的子集（按融合排名保序）。

    - 工具数不多（<= top_k）或查询为空时直接透传全部，无需预筛；
    - 预筛失败（检索异常 / 召回为空）则回退到全量 ``tools``，把完整候选池交给
      模型自行判断，绝不擅自截断、也绝不返回空池（除非 ``tools`` 本就为空）。
    """
    tool_list = list(tools)
    if not tool_list:
        return tool_list
    k = top_k or _env_int(_TOPK_ENV, 20)
    if not prefilter_enabled() or len(tool_list) <= k or not (query or "").strip():
        return tool_list
    try:
        names = get_retriever().retrieve(query, k)
        name_set = set(names)
        ordered = [t for t in tool_list if getattr(t, "name", None) in name_set]
        order = {n: i for i, n in enumerate(names)}
        ordered.sort(key=lambda t: order.get(getattr(t, "name", ""), 1 << 30))
        # 召回为空（如白名单极窄导致无交集）也回退全量，不让模型丢掉候选
        return ordered or tool_list
    except Exception:  # noqa: BLE001 — 预筛失败则全量交给模型
        return tool_list
