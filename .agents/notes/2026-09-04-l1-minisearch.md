# 决策笔记：L1.5 先例检索改用 MiniSearch

状态：已落地

## 背景

Chat 路由 L1.5 需要对小规模标注问句做毫秒级内存检索。初版用 `wink-bm25-text-search`，API（`definePrepTasks` / `consolidate`）与缺省类型体验差；且「与记忆共用 wink」不成立——记忆全文走 PGlite FTS/pg_textsearch。

## 决策

- `@chatvein/agents` L1.5 使用 **`minisearch`**（BM25 类打分）。
- 继续自研 `tokenizeForBm25`（空白切分 + CJK 二字 bigram），挂到 MiniSearch 的 `tokenize` / `processTerm`；关闭 fuzzy/prefix。
- 对外仍导出 `RouteBm25Index`（命名保留，避免调用方无谓改动）。
- 默认 `scoreMin` 按 MiniSearch 量纲重标定（当前 `0.5`）。

## 备选方案

**继续 wink-bm25**：真 BM25 够用，但类型/API 摩擦大，且无跨模块复用收益。

**自研倒排**：违背「优先成熟第三方」；先例库规模用不上。

**embedding Semantic Router**：成本与「L1 无 LLM」红线不符。

## 影响

- 收益：依赖更主流、实现更短、TS 直接可用。
- 代价：分数量纲变化，金标/阈值需按 MiniSearch 回归；文档与 [`04-依赖选型`](../../docs/phase1/04-依赖选型.md) 已同步。
- 相关：[`2026-09-04-heuristic-routing-l1.md`](./2026-09-04-heuristic-routing-l1.md)。
