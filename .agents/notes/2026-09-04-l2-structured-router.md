# 决策笔记：L2 弱模结构化路由分类

状态：已落地

## 背景

L1/L1.5 对灰区（`band=unknown`、`tools=unknown`、低置信）只能保守默认，无法可靠拍板工具与档位。需要一层**可选**的弱模决策，且不得把「对话意图」从主模型 ReAct 中拆走，也不得把分类塞进 ReAct 多轮。

## 决策

- L2 在 `routing/l2/`：`StructuredL2Classifier` = 图外单次 LLM 调用 → JSON → `L2Judgement`（zod）→ `mergeL2Judgement`。
- **触发**：`shouldEscalateToL2`（非 terminal 且低置信 / band unknown / tools unknown）。寒暄等高置信不进 L2。
- **契约**：`band` 禁止 unknown；`tools` 仅 `none|full`（消化 L1 的 `unknown`）；`reason` 只进 `reasons`。
- **失败策略**：超时 / 解析失败 → 保留 L1，追加 `l2_timeout` / `l2_failed`（宁保守不瞎拍）。
- **无模型**：`createL2Classifier()` → `PassthroughL2Classifier`；app 通过 `router.setL2(...)` 注入。
- **app**：`chat.service.routerWithL2` 优先 flash/mini/turbo 等弱模名，否则回退当前 Agent 模型（低温 + 短 maxTokens）。
- **边界**：L2 不做开放域意图；语义理解仍归主 ReAct。L2 不增加 ReAct recursion。

## 备选方案

**每条消息都过 LLM 路由**：否；违背 L1 毫秒红线与成本目标，寒暄也浪费调用。

**Embedding Semantic Router 作 L2**：否；更适合固定意图槽，难以一次产出完整 `RoutePolicy`；与「结构化 policy」目标不匹配。

**把意图分类做成 ReAct 必调工具**：否；至少 +1 步，且与回答缠在一起，难测难缓存。

**L2 输出仍允许 tools=unknown**：否；L2 的职责就是拍板灰区，再 unknown 无意义。

## 影响

- 收益：灰区可消化 `tools:unknown`；路由与主对话解耦；单测可 `callModel` 注入。
- 代价：灰区多一次弱模延迟；无独立 weak 模型表时可能与主模同价（需后续分档表）。
- 相关：[`2026-09-04-heuristic-routing-l1.md`](./2026-09-04-heuristic-routing-l1.md)、[`2026-09-04-tool-policy-unknown.md`](./2026-09-04-tool-policy-unknown.md)、[`docs/design/09-启发式规则路由.md`](../../docs/design/09-启发式规则路由.md)。
