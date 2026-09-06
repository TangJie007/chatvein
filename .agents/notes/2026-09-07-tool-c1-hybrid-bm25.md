# 决策笔记：工具 C1 混合检索（向量 + 名/别名 BM25）

状态：已落地

## 背景

工具预筛曾只靠向量相似度；`minScore=0` 且 `topK` 被抬成候选全集时近乎全量召回。更关键的是：用户口语里的「写文件 / 算一下」对应目录 `keywords` 与工具名拆词，属于**精确符号信号**，纯 embedding（尤其短中文）经常排不稳。记忆侧 design/04 已定 RRF 混合；移除 L1 BM25 时笔记也写明：若要工具 BM25，应挂 `@chatvein/tools`，不复用路由先例。

## 决策

- `@chatvein/tools` 引入 **`minisearch`**：`ToolBm25Index` 索引 `name` / `human` / `aliases`（catalog keywords）/ `title`，分词 `tokenizeForBm25`（空白 + CJK bigram）。
- `ToolVectorIndex.select` 改为 **向量路 + BM25 路 → RRF**（默认 `lexicalWeight=1.25`），最终截断为固定 `prescreenTopK`，不再 `Math.max(topK, candidateCount)`。
- 启动 warmup 签名命中：`markReady(tools)` 必须 hydrate 内存 BM25；埋点 `c1=hybrid`。
- 向量仍空时上层才回退 `keywordSelect` / full。

## 备选方案

**只调 minScore / 修 topK**：能止血全量召回，但仍漏「别名强匹配、向量弱」的查询。

**加权线性融合原始分**：向量 cosine 与 MiniSearch BM25 量纲不同，要标定；RRF 与 design/04 一致、少旋钮。

**LanceDB FTS 做 lexical**：工具集很小，进程内 MiniSearch 足够；避免把别名检索绑在原生向量库生命周期上。

**复用已删的 L1 先例 BM25**：先例语料是问句→band，不是工具别名；包边界错误。

## 影响

- 收益：名/别名命中可抬升排序；固定 Top-K 真正收窄 C2 输入；与「工具 BM25 挂 tools」旧笔记一致。
- 代价：tools 多一个 `minisearch` 依赖；warmup 跳过写库路径必须传 tools。
- 后续注意：别名质量仍靠 catalog `keywords`；可按埋点再调 `lexicalWeight` / `rrfK`。
- 相关：[`2026-09-06-remove-l1-bm25-prototypes.md`](./2026-09-06-remove-l1-bm25-prototypes.md)、[`../docs/design/12-Agent工具层.md`](../docs/design/12-Agent工具层.md)。
