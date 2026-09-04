# 决策笔记：工具策略用 unknown 替代 read_only

状态：已落地

## 背景

L1 启发式无法可靠区分「只需读工具」与「需要写/执行工具」。原先的 `read_only` 中间档容易在规则层假阳性（如「查询」抬成只读工具），又不足以真正约束执行面。

## 决策

- `ToolPolicy` 为 `none | unknown | full`（见 `@chatvein/common` `chat/route`）。
- `tool_verb` 将 `tools` 标为 `unknown`，表示 L1 不确定，需交 L2 再判。
- `synthesizeTools`：`negate_tools` 锁定 `none`；任一 `unknown` 则结果为 `unknown`；否则在 `none|full` 间取更开放者。
- BM25 采纳投票时不得直接覆盖规则侧 `tools`，须经 `synthesizeTools`（`unknown` 粘性）。
- `shouldEscalateToL2` 在 `policy.tools === 'unknown'` 时也为真。

## 备选方案

**保留 `read_only` 三档**：L1 对「查/看/读」假阳性高，且执行层尚未按强度裁剪白名单，中间档无落地收益。

**tool_verb 直接抬到 `full`**：过激；天气/知识查询会被放开完整工具。

**BM25 先例可覆盖规则的 tools**：否决；会把 `tool_verb → unknown` 冲成天气先例的 `none`，失去「交 L2」语义。

## 影响

- 收益：工具强度语义与「灰区交下一层」一致；假阳性查询不再假装已定只读。
- 代价：在 L2 落地前，`tools: unknown` 仍可能被下游保守当成满配或空配，需尽快接 L2 或执行层默认策略。
- **更新（同日 L2 落地）**：灰区已由 Structured L2 拍板 `none|full`；见 [`2026-09-04-l2-structured-router.md`](./2026-09-04-l2-structured-router.md)。
- 相关：[`2026-09-04-heuristic-routing-l1.md`](./2026-09-04-heuristic-routing-l1.md)、[`docs/design/09-启发式规则路由.md`](../../docs/design/09-启发式规则路由.md)。
