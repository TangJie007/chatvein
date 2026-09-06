# 决策笔记：L1 仅寒暄短路，其余 defer L2

状态：已落地

## 背景

L1 原先用规则 bump + MiniSearch 先例投票可自信定档（`band` / `tools`），只有灰区才进 L2。假阳性（如「你好+真问题」、弱先例拖成 simple/none）与「工具动词直接 tools=full 跳过 L2」并存，导致策略层与弱模分类职责重叠。产品方向改为：L1 只做零成本寒暄短路；复杂度与工具策略交给 L2。

## 决策

- `materialize`：**仅** `greeting_trivial` / `self_intro_trivial`（高置信 + `band=trivial`）终局短路；`empty` / `slash` / `mention` 仍 terminal。
- 其余消息：保留规则 score、`hint*`、`negate_tools` 锁定、BM25 `bm25_hint` / `bm25_weak_vote` 等**软信号**，终局强制 `band=unknown` + `confident=false` + reason `defer_to_l2`。
- BM25 **不再采纳** band/tools（不再写 `bm25_vote:`）。
- `tools`：默认对齐 `policyForBand('unknown')`（full），便于 L2 失败 / Passthrough 时仍有保守工具能力；`negate_tools` 仍锁 `none`。
- `shouldEscalateToL2` 条件不变；因非寒暄一律低置信 + unknown，几乎总 escalate。

实现：`packages/chatvein/agents/src/routing/l1/materialize.ts`；文档：`docs/design/09` v0.6、`docs/design/10` §4。

## 备选方案

### 为什么不删掉规则 bump / BM25？

软信号仍进 L2 prompt（score、reasons、hint），弱模不必从零猜「像不像要工具」；删光会浪费已有词典与先例库。

### 为什么不把非寒暄的 tools 也改成 unknown？

`resolveChatTools` 对 `unknown` 绑空工具；L2 失败回退 L1 时会丢能力。未知档默认 full 更稳，由 L2 成功路径改写。

### 为什么不把「强制 escalate」写在 `shouldEscalateToL2` 白名单？

在 materialize 产出契约更清晰（决策对象自描述 `defer_to_l2`），测试与日志可读；escalate 函数保持通用谓词。

## 影响

- 收益：寒暄仍 0 token；任务类策略统一由 L2 拍板，减少 L1 假阳性终局。
- 代价：非寒暄每条多一次弱模路由调用（约百毫秒级）；L2 未注入时透传 `unknown`（保守 standard 档 policy）。
- 后续：工具 Top-K 向量选用仍在 resolveBoundTools 侧，不塞回 L1。
