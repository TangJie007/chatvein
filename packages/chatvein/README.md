# @chatvein/agents

Chatvein 的 agent 工厂包（纯 Node）：**会话母图 + 分层路由 + 工具预筛**。

路由、预算、persona、模型档位、每轮工具筛选全部内置 —— 调用方只需要给「模型 + 工具（可选）」。

```ts
import { createChatveinAgents } from '@chatvein/agents'

const agents = createChatveinAgents({
  model: { model: 'deepseek-chat', apiKey, baseUrl },
  tools,
})

const { finalText, route } = await agents.invoke({ input: '惠阳天气', thread_id: 't1' })
```

---

## 安装

```bash
pnpm add @chatvein/agents
```

依赖由包自行声明：`@langchain/core`、`@langchain/langgraph`、`langchain`、`@langchain/openai`、`deepagents`、`zod`、`es-toolkit`、`lru-cache`、`ml-distance`。

---

## 30 秒上手

```ts
import { createChatveinAgents } from '@chatvein/agents'

const agents = createChatveinAgents({
  // 1) 模型：一份配置即可，包内派生 main / fast / strong 三档
  model: {
    model: 'deepseek-chat',
    apiKey: process.env.OPENAI_KEY,
    baseUrl: 'https://api.deepseek.com/v1',
    fast: 'deepseek-lite',      // 可选：路由 L2 + 工具筛选用的弱模
  },
  // 2) 工具：候选全集，包内按 domain / 权限档 / 弱模逐层收窄
  tools: [weatherTool, readFileTool],
})

const result = await agents.invoke({
  input: '惠阳天气怎么样',
  thread_id: 'chat-1',
})

result.finalText  // 最终回复
result.route      // { lane, domain, band, maxSteps, toolsPolicy, query, reason }
result.messages   // 完整消息轨迹（含 ToolMessage）
result.task       // { plan, artifacts, repairCount, resultSummary }
```

`invoke` 内部链路：

```
entry（定路由）→ direct | agentic | orchestrated（执行）→ finalize（抽 finalText）
```

---

## 核心概念

| 概念 | 取值 | 作用 |
| --- | --- | --- |
| `Lane` | `direct` \| `agentic` \| `orchestrated` | **决定图形状**（直答 / 单 worker / 编排档） |
| `Domain` | `general` \| `code` | **决定用哪个 worker**（办公文档归 `general`） |
| `Band` | `trivial` \| `simple` \| `standard` \| `complex` | **决定执行约束**（步数 / 工具数 / 权限档） |
| `ToolsPolicy` | `none` \| `readonly` \| `full` | 本轮可用的工具权限 |

三者不要混用：`lane` 管形状、`band` 管预算、`domain` 管 worker。

内置预算表（`DEFAULT_BUDGET_TABLE`）：

| Band | maxSteps | maxToolCalls | toolsPolicy | 典型场景 |
| --- | --- | --- | --- | --- |
| `trivial` | 4 | 0 | `none` | 寒暄 / 直接问答 |
| `simple` | 12 | 6 | `readonly` | 单点查询（查天气、读文件） |
| `standard` | 512 | ∞ | `full` | 需要多步工具的任务 |
| `complex` | 1024 | ∞ | `full` | 多产物 / 需计划审批 |

---

## 配置模型

### 一份配置派生三档

```ts
createChatveinAgents({
  model: {
    model: 'gpt-4o',          // main：母图与 worker 主执行
    fast: 'gpt-4o-mini',      // fast：路由 L2 + 每轮工具筛选
    strong: 'gpt-4o',         // strong：路由 L3 升级（省略则复用 fast）
    apiKey, baseUrl,
    temperature: 0.7,
    maxTokens: 4096,
    options: { streaming: true, callbacks: [handler] },  // 三档共用
  },
})
```

`fast` / `strong` 也支持完整配置对象（不只是模型名）：

```ts
model: { model: 'gpt-4o', fast: { model: 'qwen-lite', baseUrl: 'http://localhost:11434/v1' } }
```

### 本地单模型 / 已有模型实例

直接传实例，四档共用，不再派生：

```ts
// 任何 LanguageModelLike（含 @langchain/community 的本地模型）都可直接传入
import { ChatOllama } from '@langchain/community/chat_models/ollama'

createChatveinAgents({ model: new ChatOllama({ model: 'qwen2.5' }) })
```

也可以自己构造：

```ts
import { createChatModel } from '@chatvein/agents'

const model = createChatModel({ model: 'deepseek-chat', apiKey }, { streaming: true })
```

---

## 工具

工具是**候选全集**，包内按三层收窄后再交给模型：

1. **domain**：`toolsByDomain.code` 优先于 `tools`
2. **toolsPolicy**：`none` → 空表；`readonly` → 去掉标注 `metadata.readOnly === false` 的工具
3. **每轮弱模筛选**：按本轮文本挑出真正用得上的工具

```ts
createChatveinAgents({
  model,
  tools: allTools,                                  // 候选全集
  toolsByDomain: { code: [readFile, writeFile] },   // 可选：按领域预切
  toolsFilter: { passthroughK: 8, timeoutMs: 10_000 }, // 可选：覆盖筛选参数
  // toolsFilter: false,                            // 或彻底关闭筛选
})
```

- 候选数 ≤ `passthroughK`（默认 8）时**不调模型**，直接全返
- 筛选超时 / 解析失败 → **回退全部候选**（宁多给勿漏，永不阻断路）
- 同文本筛选结果有 LRU 缓存（`toolsFilterCacheMax`，默认 64 条）

单独使用筛选器：

```ts
import { createToolsFilterAgent } from '@chatvein/agents'

const filter = createToolsFilterAgent({ model: fastModel })
const { tools, toolIds, via, reason } = await filter.filter({ message: '查天气', tools })
```

---

## 路由

### 默认：内置分层路由

不传任何配置即启用完整 L0→L1→L2→L3：

| 层 | 手段 | 说明 |
| --- | --- | --- |
| L0 | 确定性 | 安全护栏 → 显式锁定 → LRU 缓存，零模型调用 |
| L1 | 规则 + 语义 | 关键词 / 原型种子，离线可用 |
| L2 | 弱模 | 结构化判定 lane/domain/band |
| L3 | 强模 | 置信不足或安全 `review` 时升级收口 |

需要微调时传覆盖项：

```ts
createChatveinAgents({
  model,
  router: {
    thresholds: { accept: 0.85, escalate: 0.6 },
    timeoutMs: { l2: 3000, l3: 8000 },
    cache: false,                 // 关闭路由缓存
    // search / embed：注入向量检索端口以启用 L1 语义
  },
})
```

### 关闭路由

```ts
createChatveinAgents({ model, router: false })
// 母图按默认档 direct·general·trivial 执行
```

### 文内指令（用户侧锁定）

行首 `/`、`#`、`@` + 指令名：

```
/code 修一下这个类型报错      → agentic · code
#auto 你好                    → 忽略一切外部锁定，重新路由
@agentic 帮我查一下并总结
```

指令表见 `DIRECTIVES`（可从 `@chatvein/agents/router` 导入）：
`chat / simple / agent / agentic / plan / complex / code / dev / office / doc / auto`。

### 跳过图内路由（runtime 已跑过）

```ts
const decision = await agents.router!.route({ text: '惠阳天气' })
await agents.invoke({
  input: '惠阳天气',
  route: { lane: decision.lane, domain: decision.domain, band: decision.band },
})
```

传了 `route` 就视为 `routeReady: true`，`entry` 不再重复路由。

### 锁定执行形态（UI 工作模式）

```ts
createChatveinAgents({ model, lockLane: 'direct', lockDomain: 'general' })
```

---

## 观测 hooks

```ts
createChatveinAgents({
  model,
  hooks: {
    onNode: (name, state) => console.log('→', name),
    onRoute: (decision) => console.log('route', decision.decidedBy, decision.meta.layerPath),
    onToolsFilter: (r) => console.log('tools', r.toolIds, r.via),
    onInterrupt: (payload) => askUser(payload),
  },
})
```

`onNode` 的节点名：`entry` / `direct:reply_only` / `direct:one_shot` / `agentic` / `orchestrated` / `finalize`。

---

## 持久化与中断

本包**不创建** SqliteSaver，由宿主注入 checkpointer：

```ts
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite'

const agents = createChatveinAgents({
  model,
  checkpointer: SqliteSaver.fromConnString('./chatvein.sqlite'),
})

// 同 thread_id 可跨轮恢复与 resume
await agents.invoke({ input: '继续上一步', thread_id: 'chat-1' })
```

安全护栏 `reject` 不进入执行图：`entry` 直接写 `finalText` 后跳到 `finalize`。
`clarification`（信息不足）同理，返回反问文本，用户补全后重新 `invoke`。

---

## 进阶：直接使用下层工厂

需要细粒度控制（自定义边、stream、独立跑路由）时用下层工厂：

```ts
import { createConversationGraph, createRouterAgent, normalizeRoute } from '@chatvein/agents'

const router = createRouterAgent({ fastModel, strongModel })
const graph = createConversationGraph({
  model: mainModel,
  tools,
  router,
  checkpointer,
  budgetPolicy: { override: { maxToolCalls: 3 } },
  hooks,
})

const result = await graph.invoke({ input: '你好', thread_id: 't1' })
```

路由内部层（L0/L1/L2/L3 细节、原型语料、安全规则）走子路径导入，主入口不泄漏：

```ts
import { runL0, DEFAULT_SAFETY_RULES } from '@chatvein/agents/router'
import { createAgenticLane, resolveTools } from '@chatvein/agents/conversation'
import { createChatModel, resolveModelBundle } from '@chatvein/agents/model'
import { createToolsFilterAgent } from '@chatvein/agents/tools-filter'
```

---

## 当前状态

| 能力 | 状态 |
| --- | --- |
| `direct` lane（`reply_only` / `one_shot`） | ✅ 已落地 |
| `agentic` lane · `general` worker | ✅ 已落地（`createChatAgent`：计划 → 执行 → 自检 → 文档） |
| `agentic` lane · `code` worker | 🟡 降级为 general worker，`task.resultSummary` 标注「code worker 尚未接线」 |
| `orchestrated` lane | 🟡 降级复用 `agentic` 子图，`task.resultSummary` 标注「orchestrated 档尚未接线」 |

两处降级都**不静默、不抛错**：本轮照样产出结果，同时在 `resultSummary` 里写明「本应走哪一档」，便于 UI / 日志识别。

---

## 开发

```bash
pnpm --filter @chatvein/agents test        # vitest
pnpm --filter @chatvein/agents typecheck   # tsc --noEmit
pnpm --filter @chatvein/agents build       # tsup（cjs + esm + dts）
```

设计文档见 `docs/`：`conversation-graph-design.md`（权威设计）、`conversation-graph-implementation.md`（落地计划）、`分层路由与预算决策.md`（路由与预算）、`coder-agent-design.md`。
