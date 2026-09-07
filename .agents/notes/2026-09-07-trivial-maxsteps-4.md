# 决策笔记：L2 trivial 短答预算 maxSteps=4

状态：已落地

## 背景

L1 寒暄/自我介绍短路用 `POLICY_SHORT_CIRCUIT`（`maxSteps: 0`）合理——本地模板、不调 LLM。但 `policyForBand('trivial')` 曾直接返回同一份 policy。L2 判 `trivial` 时仍走主模型短答，app 映射 `recursionLimit = max(1, maxSteps)` 得到 **1**，ReAct（`createAgent`）易触发 `Recursion limit of 1`。接上 [2026-09-05-maxsteps-band-8-16-64](./2026-09-05-maxsteps-band-8-16-64.md) 抬 simple/standard/complex 之后，trivial 这条共用短路表的缺口仍在。

## 决策

拆出 `POLICY_TRIVIAL_SHORT`，仅给 L2 / `policyForBand('trivial')`：

| 常量 | 用途 | maxSteps |
|------|------|----------|
| `POLICY_SHORT_CIRCUIT` | L1 寒暄/自我介绍/empty/slash | **0**（本地短路） |
| `POLICY_TRIVIAL_SHORT` | L2 band=trivial 默认 | **4**（短答预算） |

实现：`packages/chatvein/agents/src/routing/policy.ts`；文档：`docs/design/10`、`11`、`09` §7。取代旧笔记中「trivial → 0」作为 **band 默认** 的表述（L1 短路仍为 0）。

## 备选方案

**继续共用 SHORT_CIRCUIT、只在 app 抬 recursionLimit 下限**：能止血，但 policy 语义仍是「0 步」，thinking/遥测易误导；否决。

**trivial=8 与 simple 对齐**：对纯闲聊偏宽；用户指定短答上限 4 步，采纳。

**L2 trivial 也改本地模板**：体验差且与「L2 trivial ≠ 本地模板」设计冲突；否决。

## 影响

- 收益：L2 trivial 短答不再被 `recursionLimit=1` 误杀；L1 短路语义不变。
- 代价：闲聊档允许多一轮图内跳转（最多 4），略高于「纯单次调用」理想。
- 后续注意：若 L2 显式回传 `maxSteps: 0` 仍会落到旧坑；prompt 已提示缺省用 band 默认，一般省略该字段即可。
