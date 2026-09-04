# `@chatvein/agents`

Chat 产品轨的 **Agent 运行时**：

1. **启发式路由**（L1 / L1.5 → 可选 L2）：无 LLM、毫秒级分流，产出 `RouteDecision`
2. **ReAct**：LangChain `createAgent`（LangGraph）+ 工具绑定

普通对话与群成员单次发言都由本包驱动。契约类型在 `@chatvein/common`（`chat/route`）。设计见 [`docs/design/09-启发式规则路由.md`](../../../docs/design/09-启发式规则路由.md)。

## 目录

```
src/
  react-agent.ts      # createReactChatAgent / invokeReactChatAgent
  define-tool.ts
  routing/
    pipeline.ts       # HeuristicRouter：L1 → 可选 L2
    l1/               # 特征 / json-rules-engine / MiniSearch 先例 / materialize
    l2/               # 弱模型分类 stub（Passthrough）
    locales/          # zh 词典 + prototypes/zh.json
```

## 启发式路由（已落地）

```ts
import { getDefaultHeuristicRouter } from '@chatvein/agents'

const decision = await getDefaultHeuristicRouter().route({
  text: '你好',
  session: {
    turnIndex: 0,
    lastAssistantHadTools: false,
    recentFailure: false,
    activeMode: 'chat',
  },
})
// decision.band / policy.modelTier / policy.tools / policy.maxSteps / reasons …
```

| 层 | 作用 |
|----|------|
| **L1** | `extractFacts` + `json-rules-engine`（词典在 `locales/zh.json`） |
| **L1.5** | 灰区用 **MiniSearch** 检索 `locales/prototypes/*.json`，投票 band/tools |
| **L2** | `shouldEscalateToL2`（低置信 / `band|tools=unknown`）；一期 stub 透传 |

要点：

- 寒暄整句 → `trivial` + `maxSteps: 0`（app 可本地礼貌短路，不调 ReAct）
- `tools: unknown` = L1 不确定，交 L2；`none` / `full` 为确定档
- 拉群仅 `hintUserCreateGroup`（UI）；Agent 多智能体用 `allowSubAgents`，不建群
- app `chat.service` 在 ReAct 前调用，并消费 `maxSteps` 等 policy

## 最简 ReAct（已落地）

```ts
import { createLangChainChatModel } from '@chatvein/models'
import {
  createReactChatAgent,
  defineAgentTool,
  invokeReactChatAgent,
} from '@chatvein/agents'
import { z } from 'zod'

const model = createLangChainChatModel({
  id: 'chat',
  baseUrl: 'https://api.example.com/v1',
  apiKey: process.env.API_KEY,
  model: 'gpt-4.1-mini',
})

const echo = defineAgentTool({
  name: 'echo',
  description: '回显',
  schema: z.object({ text: z.string() }),
  invoke: ({ text }) => text,
})

const agent = createReactChatAgent({
  model,
  tools: [echo],
  systemPrompt: '你是助手，需要时可调 echo。',
})

const { content } = await invokeReactChatAgent(agent, { message: '你好' })
```

- **不自研** ReAct while 循环；使用 `langchain` 的 `createAgent`。
- 模型：生产用 `createLangChainChatModel`（`ChatOpenAI` 桥接）。
- app 的 `chat/*` 只应调本包，不得内嵌 LangGraph。流式 / IPC 见 [`docs/design/08`](../../../docs/design/08-流式对话与Markdown渲染.md)。

## 依赖（路由相关）

- `json-rules-engine` — L1 规则
- `minisearch` — L1.5 先例检索（CJK bigram 自研分词）
- `es-toolkit` — 通用工具
