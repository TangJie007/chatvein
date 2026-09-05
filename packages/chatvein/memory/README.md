# `@chatvein/memory`

分层记忆读写管线：个人 / 群组 / 全局。控制注入上下文的 token 与 prompt 缓存前缀稳定。

向量检索委托 `@chatvein/vector`；预算与截断走 `@chatvein/context`。排期 CP2。
设计见 [`docs/design/03-记忆方案.md`](../../../docs/design/03-记忆方案.md)。

## 已落地：短期记忆（会话内工作记忆）

设计见 [`docs/design/14-短期记忆方案.md`](../../../docs/design/14-短期记忆方案.md)。

三段式：近因窗口（逐字）+ 滚动摘要（压缩）+ token 预算（护栏）。纯逻辑、零 IO——落盘与模型调用由调用方注入。

```ts
import {
  planShortTerm, // 读：全量历史 → { summaryBlock?, active, pending, stats }
  consolidateShortTerm, // 写：pending ≥ summarizeEvery → 合并进滚动摘要（可降级为抽取式）
  buildSummarizePrompt, // 弱模型摘要 prompt
} from '@chatvein/memory'
```

- 摘要块作为 `role: 'system'` 前置，构成稳定前缀以命中 prompt 缓存。
- 摘要器缺失 / 抛错 / 返回空 → 自动降级为确定性抽取式摘要，关掉模型也能收敛。
- 状态落盘由调用方负责（app 侧 `{workspacePath}/memory/short-term.json`）。
