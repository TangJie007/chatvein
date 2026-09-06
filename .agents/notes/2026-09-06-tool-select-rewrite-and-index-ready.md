# 决策笔记：工具筛选接线与索引 ready 约定

状态：已落地

> 承接并落地 [`2026-09-06-l2-rewrite-and-complexity.md`](./2026-09-06-l2-rewrite-and-complexity.md) 中「选型器接线另议」项。

## 背景

路由 L2 已产出 `rewrittenQuery`，工具向量索引也有启动 warmup，但对话侧仍用裸口语检索，且每轮 `void syncToolIndex`。更糟的是：warmup 在内容签名命中时零成本跳过写库，却不把进程内 `ToolVectorIndex.built` 置 true——向量页能看到 `tool_index` 行，C1 `select` 却一直返回 `[]`，上层回退全候选；埋点还把这种情况标成 `vector+l2`。产品约定工具只在启动或 MCP 菜单变更时维护，对话回合不应再动态补库。

## 决策

1. **检索 query**：`resolveBoundTools` 使用 `route.rewrittenQuery?.trim() || 原文`；thinking 展示所用检索句。
2. **索引生命周期**：启动 `warmupToolIndex`；配置变更走公开 `refreshToolIndex()`；**对话路径删除每轮 sync**，预筛前 `awaitToolIndexWarmup()`。
3. **签名命中必须 `markReady()`**：磁盘快照有效时只标记进程内 ready，不再误判「未建索引」。
4. **C1 链**：向量命中 → 用向量；否则关键词 `keywordSelect`（缩窄才采纳）；再否则全候选。
5. **C2**：`llmSelectTools` 返回 `{ toolIds, status }`；埋点 `selector` 形如 `vector+c2` / `keyword+c2fallback:…` / `full+none`，按真实路径而非「ready 即 vector+l2」。

## 备选方案

### 为什么不在对话里继续 void sync？

与「进对话后工具集冻结」产品边界冲突；且不等待 ready 时本轮必然空召回，造成系统性全量回退。配置变更应显式 `refreshToolIndex`。

### 为什么签名命中不直接 `build([])`？

`build` 会再次 upsert；快照已一致时只需内存闸门打开。`markReady()` 语义更清晰，也避免无意义嵌入写。

### 为什么关键词命中「等于全集」时仍算 full？

`keywordSelect` 无命中时返回全部 id；若当有效缩窄会假阳性。仅当命中集严格小于候选数才采用。

## 影响

- 首次对话可能短暂等待 warmup（通常已在后台完成）；换来 C1 真能检索。
- MCP UI 落地保存时需调用 `ChatService.refreshToolIndex()`。
- 旧埋点字符串 `vector+l2` 不再出现；排障看 `c1=` / `c2=` / `indexReady=`。
