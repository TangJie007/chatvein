"""工具预筛：向量 + BM25 两路召回 + RRF 融合。"""

from agents.tool_retriever import _rrf, prefilter_tools
from mcps.registry import all_tools


def test_rrf_fuses_two_rankings() -> None:
    # BM25 把 idx0 排第一，向量把 idx2 排第一；融合后 idx0/idx2 应高于 idx1
    bm25 = [3.0, 1.0, 0.0]
    vec = [0.0, 0.1, 0.9]
    fused = _rrf(bm25, vec)
    assert fused[0] > fused[1]
    assert fused[2] > fused[1]


def test_rrf_handles_missing_vector() -> None:
    bm25 = [3.0, 1.0, 0.0]
    fused = _rrf(bm25, None)
    assert fused == [1 / 61, 1 / 62, 1 / 63]


def test_prefilter_keeps_query_named_tool() -> None:
    tools = all_tools()
    # 查询里直接点名 calculator：预筛结果应把 calculator 收进来
    out = prefilter_tools("帮我用 calculator 算一下 (1+2)*3", tools)
    names = {t.name for t in out}
    assert "calculator" in names
    assert len(out) <= 20


def test_prefilter_never_empty_when_input_nonempty() -> None:
    tools = all_tools()
    out = prefilter_tools("完全无关的一句话 xyzqwk", tools)
    # 哪怕没命中，也应回落到前 top_k 个，而非空池
    assert out


def test_prefilter_short_circuits_small_pool() -> None:
    tools = all_tools()[:3]
    out = prefilter_tools("query", tools)
    assert len(out) == 3
