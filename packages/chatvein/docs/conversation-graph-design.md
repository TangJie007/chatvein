# 会话母图设计：direct · agentic · orchestrated

- 位置：`packages/chatvein/agents/docs/conversation-graph-design.md`
- 状态：**设计定稿**（Electron 桌面单用户 agent；完整目标形态，非分期草案）
- 适用：Chatvein **桌面级用户型 agent**（本地文件权限、BYO key / 可本地模型、用户即数据所有者）
- 关联：
  - 实现：`packages/chatvein/agents/src/conversation/`
  - 路由契约：`docs/分层路由与预算决策.md`（`Lane` / `Domain` / `RouterDecision`）
  - 编码 worker：`docs/coder-agent-design.md`
  - 运行时：`@chatvein/runtime`（`runTurn`）
  - 红线：`.cursor/rules/prefer-third-party.mdc` —— **优先成熟第三方，不自研循环**
- **能力边界**：`@chatvein/agents` 为纯工厂包。persona、母图、lane / worker 默认提示**内化在本包**；宿主只注入 model / tools / checkpointer / hooks。

> **与 Router 词汇统一**：执行形态一律称 **`lane`**（`direct` | `agentic` | `orchestrated`），不再使用 `tier` / `simple|standard|complex` 双轨命名。Router 产出决策，母图按 `lane` 选图形状。

---

## 1. 问题与结论

### 1.1 问题

按**领域**切执行路径（`chat` / `office_files` / `office_complex` / `coder`）不通用：

| 真实需求 | 按领域切路径 |
| --- | --- |
| 跨领域的「单步骤任务」 | 每领域各写一遍短流水线 |
| 「复杂」程度相同但领域不同 | 编排逻辑重复 |
| 领域状态与图形状耦合 | 改图形状要动多条路径 |

图形状（要不要规划、HITL、并行）应由**任务执行形态**决定，领域只决定工具与 worker。

### 1.2 红线怎么读

> **「优先成熟第三方、不自研循环」≠ 只能用 `createAgent`。**

显式 LangGraph 节点与边，循环仍由 LangGraph 执行。`createAgent` / `deepagents` 是 **worker / 子图**，不是整轮唯一形态。

### 1.3 结论

**一张会话母图 + 三档 `lane`（`agentic` / `orchestrated` 内按 `domain` 选 worker）**：

| lane | 含义 | 图形状 |
| --- | --- | --- |
| `direct` | 简单对话 | 单次模型调用，0~1 工具，无自主循环 |
| `agentic` | 标准任务 | 单领域、单条自主循环 / 短流水线，`maxSteps` 封顶 |
| `orchestrated` | 复杂任务 | 澄清 → 规划 →（HITL）→ 执行 → 校验 → 交付；可并行、可修复 |

**两个正交轴**（与 Router 一致）：

- `lane` —— 决定**图形状**
- `domain`（`general` | `code`）—— 决定 **worker 角色**（通用 / 编码），不改变图结构；原 office 归 `general`

---

## 2. 目标与非目标

### 目标

1. 用显式母图表达本轮 `lane`，可观测、可单测、可 resume（HITL）。
2. `lane` 与 `domain` 解耦：新增领域只加 worker，不加 lane。
3. 任务状态（`route` / `task`）与消息轨迹并存，支撑 HITL、产物追踪、桌面确认流。
4. ReAct / deepagents 只出现在需要自主探索的 worker 内。
5. 与 Router 输出契约一一对应：母图消费 `RouterDecision`（或等价预填），不在图内重造路由语义。

### 非目标

- 不在本包实现审批 UI、IPC、会话库（归 `app` / runtime）。
- 不自研 agent 调度 while 循环。
- 不做多租户配额、网关计费、可插拔远程缓存（桌面单机进程内即可）。
- 不把复杂 SOP 塞进 `direct` / `agentic` 冒充「更强对话」。

### 桌面端约束（设计必须满足）

| 约束 | 对母图的含义 |
| --- | --- |
| 用户是数据所有者 | 破坏性 / 写盘 / 外发 → `interrupt` 确认，不是静默代办 |
| 真实本地 FS 权限 | `toolsPolicy` 与 HITL 是一等公民；对话档默认勿给写权限 |
| 用户就在屏幕前 | 缺槽位优先 `clarification` / `interrupt`，勿硬猜 |
| 可离线 / 本地模型 | Router 可降级；母图在已有 `route` 下仍可执行 |
| 隐私优先 | 工具与文件路径留在本地执行图，不把路由职责混进执行 |

---

## 3. 母图总览

```mermaid
flowchart TD
  START([START]) --> entry

  entry{|route.lane|}
  entry -->|direct| direct
  entry -->|agentic| agentic
  entry -->|orchestrated| orchestrated

  direct --> finalize
  agentic --> finalize
  orchestrated --> finalize
  finalize --> END([END])
```

**工厂 API**：`createConversationGraph(options)` → `{ graph, invoke }`  
**源码**：`packages/chatvein/agents/src/conversation/`

### 3.1 节点职责

| 节点 | 职责 |
| --- | --- |
| `entry` | 写入 / 确认 `route`（`lane` + `domain` + 执行所需字段）：lock → 预填 Router 决策 → 图内 Router（可选）→ 默认 `direct` |
| `direct` | 小工具人 worker：`workers/direct`（`reply_only` / `one_shot`） |
| `agentic` | 按 `domain` 分发：`general`（须列计划）/ `code`（须 write_todos） |
| `orchestrated` | 编排子图：clarify → plan → HITL → execute（嵌入 general/code worker）→ repair → verify → deliver |
| `finalize` | 抽取 `finalText`，整理对外结果 |

### 3.2 `entry` 路由优先级

1. 工厂或调用方 `lockLane` / `lockDomain`（等同 UI 工作模式锁定）
2. 预填 `route` 且 `routeReady === true`（runtime 已跑完 Router 后注入）
3. 提供 `routerModel`（或既有 `filterModel`）时，图内调用 Router，须产出完整 `lane` + `domain`
4. 否则默认 `lane: 'direct'`, `domain: 'general'`

> Annotation 的 `route` 必有默认值，无法表达「未路由」。用 **`routeReady`**：仅当调用方显式预填或 `entry` 写完 route 后为 `true`，避免默认 route 吞掉 Router。

### 3.3 与 Router 的职责切分

```
Router：决定 lane / domain / band / budget / safety / query / clarification
母图：按 lane 跑执行图；budget 与 tools 由工厂闭包按本轮决策装配，不进可脏缓存的语义核
```

- `safety.verdict === 'reject'`：不得进入执行图（runtime 在 invoke 前终止）。
- `safety.verdict === 'review'`：Router 已抬至 `orchestrated`（或等价）；母图走 HITL 路径。
- `clarification` 已给出：本轮可不进执行图，由 app 先展示反问；用户补全后再路由。

---

## 4. 状态模型

```ts
type Lane = 'direct' | 'agentic' | 'orchestrated'
type Domain = 'general' | 'code'
type Band = 'trivial' | 'simple' | 'standard' | 'complex'

/** 母图执行所需的路由快照（由 RouterDecision 投影，非完整预算策略对象） */
interface ConversationRoute {
  lane: Lane
  domain: Domain
  band: Band
  maxSteps: number                 // agentic 循环上限；orchestrated 内单个 worker 亦受此约束
  toolsPolicy: 'none' | 'readonly' | 'full'
  query: {
    rewritten: string
    searchQuery?: string
    slots?: Record<string, unknown>
    intents?: string[]
  }
  reason?: string
}

interface TaskArtifact {
  id: string
  path: string
  mime?: string
  role: 'input' | 'draft' | 'output'
  summary?: string
}

interface PlanStep {
  id: string
  title: string
  kind: 'tool' | 'agent' | 'files' | 'human'
  domain?: Domain                  // 子步骤领域，供 step_router 选 worker
  status: 'pending' | 'doing' | 'done' | 'failed' | 'skipped'
  risk: 'low' | 'high'
  error?: string
}

interface TaskState {
  intent?: string
  artifacts: TaskArtifact[]
  plan: PlanStep[]
  repairCount: number
  resultSummary?: string
}

// Annotation 通道
// messages | route | routeReady | task | finalText
```

**约定**：

- `messages`：`messagesStateReducer`；worker 整表替换时用 `Overwrite`。
- `tools` / 完整 `budget`（token 墙钟等）**不进 checkpoint 友好 state**：由工厂按本轮 `RouterDecision` 闭包注入；策略变更不得被旧 checkpoint 绑死。
- `lane` 管图形状；`band` / `maxSteps` / `toolsPolicy` 管执行约束；`domain` 管 worker。三者勿混用。
- `task` 服务 `orchestrated`（及需要产物追踪的 `office` agentic）；`direct` 可空壳。

---

## 5. Lane 设计

### 5.1 `direct` — 简单对话

覆盖：寒暄、概念问答、确认/澄清、trivial 单点查询。

```mermaid
flowchart LR
  enter --> gate{|toolsPolicy|}
  gate -->|none| reply_only
  gate -->|readonly / full| one_shot
  reply_only --> exit
  one_shot --> exit
```

| 子路径 | 实现 |
| --- | --- |
| `reply_only` | 单次 `model.invoke`，无工具 |
| `one_shot` | 单次 `model.invoke` + **至多 1 次**工具调用，不进 ReAct 循环 |

**禁止**：多步工具链（那是 `agentic`）。  
**桌面默认**：无明确只读工具需求时 `toolsPolicy = none`。

### 5.2 `agentic` — 标准任务

覆盖：单领域、短到中等工具链。一条自主循环在 `maxSteps` 内收敛；**general / code 均须先列计划再执行**。

```mermaid
flowchart TD
  enter --> dispatch{|domain|}
  dispatch -->|general| react_chat
  dispatch -->|code| coder_task
  react_chat --> exit
  coder_task --> exit
```

| worker | 实现 |
| --- | --- |
| `react_chat` | `createAgent`；persona 要求先列短计划再调工具 |
| `coder_task` | `createCoderAgent.graph`（deepagents）；`write_todos` 强制先计划 |

策略：

- `general` + 工具 → 短 ReAct，`recursionLimit ≈ maxSteps`；文档解析等原 office 场景归此
- `code` → deepagents，`recursionLimit` 常对齐更高档（如 64）
- **禁止**把多文档 SOP / 长审批链塞进本档（抬到 `orchestrated`）

> `agentic` 是「**单条自主循环**」的统称；`domain` 只决定 general vs code。`direct` 也是 worker（小工具人），见 `workers/direct`。

### 5.3 `orchestrated` — 复杂任务

覆盖：多步骤、多产物、要规划 / 人确认 / 回环（投标材料、多文件重构、跨工具串联等）。

```mermaid
flowchart TD
  enter --> clarify{|缺关键槽位?|}
  clarify -->|缺| ask_user
  ask_user -->|人补全| clarify
  clarify -->|齐| plan
  plan --> approve{|高风险或需确认?|}
  approve -->|interrupt| hitl_plan
  hitl_plan --> execute
  approve -->|免审| execute

  execute --> step_router{|下一 PlanStep|}
  step_router -->|general| w_general
  step_router -->|office| w_office
  step_router -->|code| w_code
  step_router -->|探索| step_agent
  w_general --> update_plan
  w_office --> update_plan
  w_code --> update_plan
  step_agent --> update_plan
  update_plan -->|还有步骤| step_router
  update_plan -->|完成| verify
  update_plan -->|失败可修| repair
  repair --> step_router
  verify --> deliver
  deliver --> exit
```

| 节点 | 职责 |
| --- | --- |
| `clarify` | 对照 `query.slots` / `intents` 查缺；缺则 `interrupt` 问用户 |
| `plan` | LLM → `PlanStep[]`（可消费 `query.intents`） |
| `hitl_plan` | `interrupt`：展示/改计划后 resume（桌面确认 UI） |
| `w_general` / `w_office` / `w_code` | **复用已编译的 agentic worker 子图**（禁止复制流水线） |
| `step_agent` | 探索型子任务：可挂 deepagents |
| `update_plan` | 更新 step 状态、累积 `task.artifacts`、记录失败 |
| `repair` | 有限次（`task.repairCount`）；超出则 `interrupt` 交用户 |
| `verify` / `deliver` | 清单校验 + 最终汇报 → `task.resultSummary` |

**并行**：无依赖的 `PlanStep` 可在 `execute` 内扇出；有依赖则串行。  
**安全**：`risk: high` 的 step 执行前必须经过确认（计划级 HITL 或步进 HITL）。

### 5.4 正交矩阵

| | direct | agentic | orchestrated |
| --- | --- | --- | --- |
| general | `workers/direct` 小工具人 | `createAgent`（先列计划） | plan → execute → verify（嵌入 general） |
| code | （无改码时走 general/direct） | `createCoderAgent`（write_todos） | 同上（嵌入 coder） |

---

## 6. 与 Router / Runtime 的衔接

### 6.1 目标主路径

```
runTurn:
  （可选）C1/C2 工具预筛 —— 留在 runtime，结果闭包注入
  → createRouterAgent.route(...) → RouterDecision
  → 若 reject / 仅 clarification：app 处理，不 invoke 母图
  → createConversationGraph({ model, tools, middleware, checkpointer, ... })
  → graph.invoke({
       messages,
       route: project(decision),   // lane/domain/band/maxSteps/toolsPolicy/query
       routeReady: true,
       thread_id
     })
```

### 6.2 工具预筛

固定策略：**C1/C2 留在 runtime**，母图不设 `prepare_tools` 节点。母图只消费已装配的 tools 闭包。

### 6.3 Checkpointer 与 HITL

- 母图统一 `SqliteSaver`（或等价）+ `thread_id`。
- `interrupt` → app hooks 弹确认 / 改计划 → 同 `thread_id` resume。
- 桌面端用户始终在场：HITL 是默认能力，不是可选插件。

### 6.4 决策投影

```ts
function projectRoute(d: RouterDecision): ConversationRoute {
  return {
    lane: d.lane,
    domain: d.domain,
    band: d.band,
    maxSteps: d.budget.maxSteps,
    toolsPolicy: d.budget.toolsPolicy,
    query: d.query,
    reason: d.reason,
  }
}
```

| Router 信号 | 母图行为 |
| --- | --- |
| 寒暄 / 单点问答 | `direct` · `general` |
| 短工具链 / 单文件办公 / 单点改 bug | `agentic` · 对应 domain |
| 多产物、要计划/审批、多文件重构 | `orchestrated` · 对应 domain |
| 灰区 | Router 抬档；母图不二次降档 |
| `safety: review` | 已是 `orchestrated` + HITL |
| `safety: reject` | 不进入母图 |

---

## 7. 场景验收对照

| 用户说法 | 期望 lane·domain | 关键路径 |
| --- | --- | --- |
| 「闭包是什么」 | direct·general | reply_only |
| 「惠阳天气」 | direct·general 或 agentic·general | one_shot / 短 ReAct |
| 「把这份 PDF 条款抽成表并存 xlsx」 | agentic·general | react_chat（先计划） |
| 「修 src/index.ts 类型报错」 | agentic·code | coder_task |
| 「根据项目资料做投标应答：读 3 份标书、对齐能力、出草稿、确认后导出」 | orchestrated·general | clarify → plan → hitl → general×N → deliver |
| 「重构 utils 并同步更新 5 个调用方测试」 | orchestrated·code | plan → coder×N → verify |

黄金集应对齐 Router 黄金集的 `(text) → lane/domain`，并增加「进入母图后关键节点可达」的图级断言。

---

## 8. 工厂契约

```ts
interface CreateConversationGraphOptions {
  model: LanguageModelLike
  tools?: StructuredToolInterface[]
  middleware?: AnyAgentMiddleware[]
  checkpointer?: BaseCheckpointSaver
  /** 工作模式锁定，跳过图内路由 */
  lockLane?: Lane
  lockDomain?: Domain
  /** 未预填 route 时可选：图内调用 Router（对齐 createRouterAgent.route） */
  router?: { route(input: unknown): Promise<RouterDecision> }
  /** HITL / 可观测钩子由 runtime 经 LangGraph 配置注入 */
}

interface ConversationInvokeInput {
  messages?: BaseMessage[]
  input?: string
  route?: ConversationRoute
  routeReady?: boolean
  thread_id: string
}

interface ConversationGraph {
  graph: CompiledStateGraph
  invoke(input: ConversationInvokeInput, config?: RunnableConfig): Promise<{
    finalText: string
    task: TaskState
    route: ConversationRoute
    messages: BaseMessage[]
  }>
}
```

公开工厂：`createConversationGraph`。  
`createChatAgent` / `createCoderAgent` 可作为 **worker 级** API 保留，供母图与测试直接使用；产品主路径以母图为准。

---

## 9. 否决与边界

| 方案 | 理由 |
| --- | --- |
| 一个巨大 `createAgent` 覆盖三档 | 无法表达 SOP / 任务 state / HITL |
| 自研 while 工具循环 | 违反红线；循环交给 LangGraph |
| 按领域新增 lane | 图形状与领域耦合；应走 domain worker |
| 在 `orchestrated` 复制 agentic 流水线 | 必须 `addNode` 复用已编译 worker 子图 |
| 母图内再实现完整 Router | 职责重复；Router 单次结构化决策，母图只执行 |
| 多租户配额 / Redis 路由缓存 | 桌面单用户不需要 |
| `tier` 与 `lane` 双轨命名 | 制造映射税；统一 `lane` |

---

## 10. 代码与文档索引

| 产物 | 路径 |
| --- | --- |
| 母图 | `src/conversation/`（`graph` / `entry` / `lanes/{agentic,orchestrated}` / `workers/{direct,general,code}`） |
| 导出 | `src/conversation/index.ts`、`src/index.ts` |
| 单测 | `src/conversation/__tests__/` |
| 实现方案（落地计划） | `docs/conversation-graph-implementation.md` |
| Router 设计 | `docs/# Router Agent 设计：分层路由与预算决策.md` |
| Coder 设计 | `docs/coder-agent-design.md` |

### 实现对照（非设计分期）

设计以上述完整形态为准。代码若仍使用旧目录名（`simple`/`standard`/`complex`）或 `tier` 字段，视为**待对齐实现债**，以本文与 Router 文档为权威，而不是「另一版设计」。
