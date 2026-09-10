# 会话母图评测集（阶段 A：entry → direct → finalize）

- 位置：`packages/chatvein/agents/docs/test/conversation-graph-eval.md`
- 被测实现：`packages/chatvein/agents/src/conversation/`
- 可执行用例：`packages/chatvein/agents/src/conversation/__tests__/conversation-graph.spec.ts`
- 权威文档：
  - 设计：`docs/conversation-graph-design.md`（§5 lane 语义、§7 场景验收）
  - 实现方案：`docs/conversation-graph-implementation.md`（§6 direct、§10 预算执行点、§13 阶段 A 验收、§14 测试策略）
- 范围：**仅 direct 链路**。agentic（阶段 B）/ orchestrated（阶段 C）当前为显式占位，本集只评「占位提示是否明确」。

---

## 1. 评测目标与判分

**评测的不是「回答得好不好」，而是「图有没有按设计走」**——对齐实现方案 §14：
图级可达性断言（关键节点被走过）优先于最终文本断言。

| 维度 | 评的是什么 | 失败含义 |
| --- | --- | --- |
| 路由正确性 | `route.lane/domain/band/toolsPolicy` 是否按优先级产出 | 路由语义被绕开 |
| 节点可达性 | `entry` / `direct:reply_only` / `direct:one_shot` / `finalize` 是否被走过 | 图形状与设计不符 |
| 工具约束 | `none` 不挂工具；`one_shot` 至多 1 次工具、模型调用 ≤ 2 | direct 档退化成自研循环 |
| 预算执行点 | `checkBudget` 真的拦得住（不是声明字段） | 预算维度是幻觉 |
| 降级与错误处理 | 无 router → 默认档；未接线 lane → 明确提示；缺输入 → 明确报错 | 静默错误 |
| 状态完整性 | `finalText` 写入 state；历史消息不被吞 | checkpoint / 多轮受损 |

**判分**：本集共 14 条用例，`14/14` 全绿为通过；任一红视为**阻断**（不进入阶段 B）。
`tools-filter` 的「factory throws until implemented」为**历史遗留失败**，与本集无关，不计入。

---

## 2. 运行方式

```bash
# 仅会话母图
cd packages/chatvein/agents
npx vitest run --no-watch src/conversation

# 整个 agents 包（含 router / chat / coder）
pnpm --filter @chatvein/agents test

# 类型收口（每阶段必做）
npx tsc --noEmit -p tsconfig.json
```

约定：模型一律 mock（`src/__tests__/scripted-model.ts` 的 `ScriptedChatModel`），
**不依赖真实网络、不依赖真实大模型**。

---

## 3. 用例集

图例：路径写法 `entry → direct:one_shot → finalize` 表示节点访问顺序（`hooks.onNode` 记录）。

### 3.1 纯函数：route 投影

| ID | 用例 | 输入 | 期望 | 对应文档 |
| --- | --- | --- | --- | --- |
| E09 | `routeFromRouterPlan` 投影 | `RouterDecision{lane:direct, domain:general, band:simple, budget, query, reason}` | `maxSteps === deriveBudget('simple').maxSteps(12)`、`toolsPolicy === 'readonly'`、`query.rewritten/intents` 透传、`reason` 透传 | 实现方案 §12 |
| E10 | `DEFAULT_ROUTE` 与预算表同源 | — | `lane:direct / domain:general / band:trivial`，`maxSteps === deriveBudget('trivial').maxSteps`、`toolsPolicy === 'none'` | 实现方案 §4（纠正 §1.2 的 band/maxSteps 不一致） |
| E00 | lane / domain 映射不被破坏 | `normalizeRoute({lane:'orchestrated'})`；`dispatchAgenticWorker(...)` | `selectConversationLane → 'orchestrated'`；`general→react_chat`、`office→react_chat`、`code→coder_task` | 设计 §5.2 |

> **口径修正**：实现方案 §4 正文写「trivial → `maxSteps: 1`」，与预算表（`trivial → 4`）冲突。
> 代码以**预算表为唯一来源**（`deriveBudget('trivial')`），E10 即该口径的守门用例。

### 3.2 direct · reply_only

| ID | 用例（用户说法） | 前置 | 期望路径 | 关键断言 |
| --- | --- | --- | --- | --- |
| E01 | 「你好」 | 无 router、无预填 | `entry → direct:reply_only → finalize` | `route` 为 `direct·general·trivial` 且 `toolsPolicy:'none'`；`finalText` 为模型回复；末条消息即回复 |
| E02 | 「闭包是什么」 | 预填 `lane:direct, domain:general, band:trivial`，注入了工具 | `entry → direct:reply_only → finalize` | 模型调用次数 `=== 1`；工具**未被调用**（`toolsPolicy` 由 band 派生为 `none`） |
| E12 | 多轮历史 `[Human, AI, Human]` | 默认档 | `entry → direct:reply_only → finalize` | 返回 `messages` 仍含 2 条 `HumanMessage`（历史不被整表替换）；`state.finalText` 与返回值一致 |

### 3.3 direct · one_shot

| ID | 用例（用户说法） | 前置 | 期望路径 | 关键断言 |
| --- | --- | --- | --- | --- |
| E03 | 「惠阳天气怎么样」 | 预填 `band:simple`（→ `readonly`），注入 `weather` 工具；模型脚本：①带 1 个 tool_call ②收束文案 | `entry → direct:one_shot → finalize` | 工具被调用 1 次且入参 `{city:'惠阳'}`；`ToolMessage` 入轨；**模型调用次数 `=== 2`**；`finalText === '惠阳今天晴，26℃'` |
| E04 | 「惠阳和北京天气」 | 模型脚本：①带 **2 个** tool_call ②收束文案 | `entry → direct:one_shot → finalize` | **只执行第一个**（`called === ['惠阳']`）；`ToolMessage` 恰好 1 条；模型调用 `≤ 2`（多步工具链属 agentic，禁止出现在 direct） |
| E07 | 「你好」 | 显式 `toolsPolicy:'none'`，同时注入工具 | `entry → direct:reply_only → finalize` | 走 `reply_only`；工具 0 次；模型 1 次 |

### 3.4 entry 路由优先级（实现方案 §5）

| ID | 优先级 | 输入 | 期望 |
| --- | --- | --- | --- |
| E05 | 1 · lock > 预填 | `lockLane:'direct' / lockDomain:'general'` + 预填 `route{lane:'orchestrated', domain:'code'}` | 最终 `route.lane === 'direct'`、`domain === 'general'` |
| E06 | 3 · router port | 无预填，注入 `router.route`（返回 `direct·general·simple`）+ `weather` 工具 | router 收到用户原文；`route.toolsPolicy === 'readonly'`；`one_shot` 正常闭环 |
| E01 | 4 · 默认档 | 无 router、无预填 | `direct·general·trivial` |

> 第 2 档「预填 route 且 `routeReady === true`」由 E02 / E03 / E04 / E07 覆盖。
> `invoke({ route })` 未显式传 `routeReady` 时，按「传了 route 即视为已路由」推断为 `true`。

### 3.5 预算执行点 / 边界

| ID | 用例 | 前置 | 期望 | 对应文档 |
| --- | --- | --- | --- | --- |
| E08 | 预算触顶 | `budgetPolicy:{override:{maxToolCalls:0}}` + `band:simple` + 模型脚本①带 tool_call | 工具**不执行**；模型调用 `=== 1`；`finalText` 含「预算上限」与「超出工具调用上限」 | 实现方案 §10（direct 触顶直接 finalize） |
| E11 | 未接线 lane | 预填 `agentic·code·standard` / `orchestrated·code·complex` | 不抛错；`finalText` 含「`agentic` 占位」「阶段 B」（orchestrated 对应「阶段 C」）；模型**未被调用** | 实现方案 §9 / §13 |
| E13 | 缺输入 | `invoke({})` | 抛 `messages or input is required` | — |

---

## 4. 覆盖矩阵（对实现方案 §14）

| 测试策略条目 | 覆盖用例 | 状态 |
| --- | --- | --- |
| 1 · 图级可达性 | E01 / E03 / E04 / E07 / E11 | ✅ |
| 2 · route 优先级（lock > 预填 > router > 默认） | E05 / E02·E03（预填） / E06 / E01 | ✅ |
| 3 · HITL resume | — | ⏸ 阶段 B/C（orchestrated 才有 interrupt） |
| 4 · 降级路径（无 router → 默认档） | E01 / E11 | ✅ |
| 5 · 安全衔接（reject 不进图 / review 必 HITL） | — | ⏸ runtime 在 invoke 前拦截，阶段 B 联调 |
| 6 · 预算耗尽 | E08 | ✅（one_shot 执行点；worker 步进留待阶段 B） |
| 7 · one_shot 只跑 1 个 tool_call 且模型调用 ≤ 2 | E04 | ✅ |

**已落地但未纳入本集的检查**：`tsc --noEmit` 类型收口、无新增依赖（实现方案 §13 每阶段收口要求）。

---

## 5. 阶段 B / C 需追加的用例（占位，届时转可执行）

| ID | 用例 | 期望 |
| --- | --- | --- |
| B01 | 「惠阳天气」→ `agentic·general` | 走 `react_chat`，`recursionLimit ≈ maxSteps`，步进处 `checkBudget` |
| B02 | 「修 src/index.ts 类型报错」→ `agentic·code` | 走 `coder_task` 子图，工具按 domain 二次过滤 |
| B03 | `agentic·general` 文档类 | 走 react_chat；须先列计划（persona） |
| C01 | 「重构 utils 并同步 5 个调用方测试」 | `plan → coder×N → verify`；`risk:high` 触发 `hitl_plan` |
| C02 | HITL resume | `interrupt` 后同 `thread_id` resume，`task.plan` 被修改且继续执行 |
| C03 | `repair` 上限 | `repairCount >= 3` 时 `interrupt` 交用户 |
| C04 | `safety:review` | 必经 HITL；`safety:reject` 不进图 |

---

## 6. 变更清单（本轮阶段 A 落地）

| 文件 | 变更 |
| --- | --- |
| `src/conversation/state.ts` | 真实 `Annotation.Root`；`DEFAULT_ROUTE` 与 `deriveBudget('trivial')` 同源；新增 `cloneRoute` / `cloneTask` |
| `src/conversation/route.ts` | 实现 `routeFromRouterPlan`；`normalizeRoute` 按 band 派生 `maxSteps` / `toolsPolicy` |
| `src/conversation/budget.ts`（新） | `createBudgetTracker`（tick / probe / snapshot）——预算执行点 |
| `src/conversation/tools.ts`（新） | `resolveTools`（domain + toolsPolicy 二次过滤） |
| `src/conversation/model.ts`（新） | `invokeModel` / `bindToolsIfSupported` / `withSystemPrompt` 薄封装（无循环） |
| `src/conversation/entry/resolve-route.ts` | `createEntryNode`：lock > 预填(routeReady) > router > 默认档 |
| `src/conversation/workers/direct/*` | `reply_only` / `one_shot` 两个节点 + 子图装配（条件边按 `toolsPolicy`） |
| `src/conversation/finalize.ts` | `createFinalizeNode`，复用 `chat/agent.extractFinalAssistantText` |
| `src/conversation/graph.ts` | `createConversationGraph` 编译 + `invoke` 投影；`agentic` / `orchestrated` 显式占位 |
| `src/conversation/prompts.ts` | 新增 `DEFAULT_DIRECT_SYSTEM_PROMPT` |
| `src/__tests__/scripted-model.ts` | 迁入 `ScriptedChatModel`（记录调用次数与入参） |
| `src/conversation/__tests__/conversation-graph.spec.ts` | 本评测集的可执行版本（E00–E13） |

### 6.1 附属改造：observability 收敛为「trace + 结构化 run（LangSmith 式）+ 按会话 JSONL 缓冲/查询」（与阶段 A 同期，跨切面，不计入 direct 评测）

> 触发：对话编排本身已走 cordis 插件模式，遥测核心同步改为插件，避免全局单例到处 import；并按「先内存写、离开对话落盘」目标砍掉事件总线 / payloadRef / run-dir，落盘从纯文本日志升级为**结构化 JSONL**（每条 run 一行，Viewer 可按 `traceId` 分组、`parentRunId` 组调用树）。
> 改造后 conversation-graph 评测集 **14/14 不受影响**（图行为未变，仅新增 trace emit / run 组装）。
> 扁平事件（含 `run-turn.ts` 现有 `emit`）经内部 `TraceAssembler` 兜底组装成 `TraceRun`，全 span 化（emit 改 `span`）由调用方后续改造，无需改本包。

| 包 | 文件 | 变更 |
| --- | --- | --- |
| observability | `src/index.ts` | 插件模式：`ObservabilityPlugin` / `ObservabilityService` / `TelemetryEmitter`；导出 `TraceRun` / `TraceRunType` / `TraceAssembler` / `ConversationTraceStore` / `formatRunLine`；删除全局单例 |
| observability | `src/telemetry.ts` | 多 sink（console / 自定义）；默认 console sink；删除 `toIpcSafePayload`（实时推送移除） |
| observability | `src/trace-run.ts`（新） | `TraceRun` 模型（`id/traceId/conversationId/parentRunId/runType/startTime/endTime/status/inputs/outputs/error/metadata`）+ `buildTraceTree` + `aggregateTokens` |
| observability | `src/trace-assembler.ts`（新） | `TraceAssembler`：扁平事件 → `TraceRun`（`llm:request/response` 配对、`parentSpanId`→`parentRunId`、推断 `runType`） |
| observability | `src/format.ts` | `formatTraceLine`（兼容）/ `formatRunLine`（run 可读文本）/ `formatConversationHeader` / `formatTs` |
| observability | `src/trace-buffer.ts` | `ConversationTraceStore`：存 `TraceRun[]`，超阈值追加写 `<工作区>/traces/<conversationId>.jsonl`（首行 meta），`closeConversation` flush 剩余；新增 `queryRuns` / `readTree` / `aggregateTokens` |
| observability | `src/plugin.ts` | `ObservabilityService`：内部挂 `TraceAssembler` sink → `store.append`；新增 `openConversation` / `closeConversation` / `flushAll` / `queryRuns` / `readTree` / `aggregateTokens`；删除 `bus`/`on` |
| observability | `src/event-bus.ts` `src/trace-sink.ts` `src/jsonl-writer.ts` `src/run-dir.ts` | **删除**（eventemitter3 总线 / 旧 JSONL 落盘 / payloadRef / run-dir 布局） |
| observability | `src/README.md` `package.json` | 更新用法（三类能力 + query）；`package.json` 移除 `eventemitter3` 依赖 |
| runtime | `src/plugin.ts` | harness 装配中挂载 `observabilityPlugin`，提供 `ctx.observability`（无 persist/bus） |
| runtime | `src/types.ts` | 导出 `ObservabilityService` 类型 |
| runtime | `src/run-turn.ts` | `ctx.observability.emit('trace:route' \| 'trace:tool_select', ...)`（事件自带 conversationId via scope context；经 assembler 组装成 run） |
| runtime | `src/index.ts` | harness `runtimeService` 注册顺序（plugin 在前） |
| app | `src/main/chat/chat.service.ts` | 每轮 `send` 调 `openConversation(conversationId,{workspacePath})`；新增 `closeConversation`（经 `chat:closeConversation` IPC）落 `traces/<id>.jsonl` |
| app | `src/main/chat/chat.controller.ts` | 新增 `chat:closeConversation` 通道 |
| app | `src/renderer/api/ipc-api.ts` | `IpcApi` 加 `chat:closeConversation`；移除 `type:'telemetry'` 契约 |
| app | `src/renderer/composables/useChat.ts` | 切/删会话前调 `closeConversation`；移除 `telemetry` 订阅分支 |
| app | `src/main/agent-tools/chat-model.ts` `src/main/agent-tools/index.ts` | 用 `scope` 包 git 工具 emit |
