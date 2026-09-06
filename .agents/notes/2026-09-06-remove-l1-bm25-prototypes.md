# 决策笔记：移除 L1 BM25 先例库

状态：已落地

## 背景

L1 已改为「仅词典寒暄/自我介绍短路，其余 `defer_to_l2`」后，`prototypes/zh.json` + MiniSearch 不再定档，只写软 hint。先例里大量 `trivial` 条目与 `zh.json` 的 `greetings` / `selfIntroPrefixes` **完全重复**；其余 band 先例对 L2 收益未验证，却多维护一整套索引依赖。

## 决策

- 删除 `locales/prototypes/zh.json`、`l1/bm25-index.ts` 及相关单测。
- L1 只保留 `locales/zh.json` 词典 + `json-rules-engine`；寒暄短路不依赖先例。
- 移除 `@chatvein/agents` 对 `minisearch` 的依赖。
- `reloadPrototypes` / `RoutePrototype` 类型保留为 deprecated/兼容空操作（契约字段 `bm25Hits` 可空）。

## 备选方案

### 为什么不只删 trivial 先例、保留 simple/complex？

定档已交 L2；半残先例库仍要维护分词/投票/热更新，ROI 低。若以后要「工具选用 BM25」，应挂在 `@chatvein/tools` 别名索引，不复用路由先例。

> 已落地：见 [`2026-09-07-tool-c1-hybrid-bm25.md`](./2026-09-07-tool-c1-hybrid-bm25.md)（C1 向量 + MiniSearch 名/别名 RRF）。

### 为什么不把寒暄也改成 BM25？

词典精确匹配假阳性更可控（「你好 + 真问题」已由规则挡）；先例投票曾被明确禁止拖成 trivial。

## 影响

- 收益：locales 只剩一本 `zh.json`；包更轻；与「L1 只短路寒暄」叙事一致。
- 代价：L2 prompt 不再带 `bm25Hits` 先例线索；弱模需自行从用户原文判断复杂度。
