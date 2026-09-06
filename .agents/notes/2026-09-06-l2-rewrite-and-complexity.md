# 决策笔记：L2 工具向改写与复杂度准则

状态：已落地

## 背景

L1 收窄为寒暄/终端短路后，几乎所有任务消息都进 L2。裸用户口语直接做工具向量/BM25 检索质量差（省略动作与对象、语气词多）。同时原先 L2 prompt 对 band 边界偏松，容易把「解释概念」抬到 standard、或把「要不要工具」判飘。

## 决策

L2 在一次结构化调用里同时产出：

1. **策略拍板**：`band` / `tools` / 可选 `modelTier`/`maxSteps` 等（仍禁止 `unknown`）。
2. **必填 `rewrittenQuery`**：面向工具路由的中文语义描述（展开隐含动作与对象，非复述、非对用户回复），经 `mergeL2Judgement` 写入 `RouteDecision.rewrittenQuery`。
3. **复杂度准则写进 system prompt**：从严分档；纯知识问答倾向 `simple`+`tools=none`；路径/围栏/检索改仓至少 `standard`+`full`；不确定工具时宁可 `full`。

User prompt 只保留原文 + 廉价结构特征（长度/语言/围栏/路径/URL），不再依赖已删除的 L1 BM25/意图信号。

## 备选方案

### 为什么不用独立「改写 Agent」再跑分类？

多一次弱模调用，延迟与失败面翻倍；改写与 band/tools 高度相关，一次 JSON 更一致。

### 为什么不把改写放进 L1 / 主 ReAct？

L1 零 LLM 红线；主 ReAct 改写会污染对话轮次且拿不到干净的路由侧契约。改写留给 L2，下游工具 Top-K 可选用 `rewrittenQuery`（本期只产出字段，选型器接线另议）。

### 为什么 `rewrittenQuery` 在 L2Judgement 必填、在 RouteDecision 可选？

分类器成功路径必须有改写；L1 短路与 L2 失败路径没有该字段，故决策层保持 optional。

## 影响

- 契约：`@chatvein/common` `RouteDecision`、`l2/schema`、`l2/prompt`、`l2/merge`；thinking 日志可展示改写摘要。
- 成本：单次 L2 token 略增（多一个字段与更长 system）；换检索质量与更稳的 band。
- 后续：工具向量 Top-K 应以 `rewrittenQuery ?? raw` 为查询，勿再用裸口语。
