# `@chatvein/agents`

Chat 产品轨的 **Agent 运行时**：

1. **启发式路由**（L1 → **L2**）：L1 无 LLM（词典寒暄短路 + 规则软信号）；灰区由弱模 JSON 结构化决策（图外，不增加 ReAct 轮次）
2. **L3 执行**：LangChain `createAgent`（LangGraph）+ 工具绑定；**语义意图由主模型在此理解**（演进按 band 选预置 StateGraph）

普通对话与群成员单次发言都由本包驱动。契约类型在 `@chatvein/common`（`chat/route`）。设计见 [`docs/design/09-启发式规则路由.md`](../../../docs/design/09-启发式规则路由.md)；**L2** [`docs/design/10-L2语义路由层.md`](../../../docs/design/10-L2语义路由层.md)；**L3 执行** [`docs/design/11-L3-ReAct自适应循环推理层.md`](../../../docs/design/11-L3-ReAct自适应循环推理层.md)。

## 目录

```
src/
  react-agent.ts      # createReactChatAgent / invokeReactChatAgent
  define-tool.ts
  routing/
    pipeline.ts       # HeuristicRouter：L1 → 可选 L2
    l1/               # extractFacts + decideL1 + zh.json 词典
    l2/               # schema / prompt / merge / StructuredL2Classifier
    policy.ts         # band→policy（供 L2）；L1 只用 SHORT/DEFER 两档
```

## 启发式路由（已落地）

```ts
import {
  createL2Classifier,
  getDefaultHeuristicRouter,
} from '@chatvein/agents'
import { createLangChainChatModel } from '@chatvein/models'

const router = getDefaultHeuristicRouter()
router.setL2(
  createL2Classifier({
    model: createLangChainChatModel({
      id: 'l2',
      baseUrl: process.env.L2_BASE_URL!,
      apiKey: process.env.L2_API_KEY,
      model: 'deepseek-v4-flash',
      temperature: 0,
      maxTokens: 256,
    }),
  }),
)

const decision = await router.route({
  text: '查询一下今天北京的天气',
  session: {
    turnIndex: 0,
    lastAssistantHadTools: false,
    recentFailure: false,
    activeMode: 'chat',
  },
})
// L1 可能 tools=unknown → L2 拍板 none|full；reasons 含 l2_classifier
```

| 层 | 作用 |
|----|------|
| **L1** | `extractFacts` + `decideL1`（词典寒暄/自我介绍/terminal）；其余 defer_to_l2 |
| **L2** | 非寒暄 escalate；弱模 JSON；`mergeL2Judgement`；失败则保留 L1（`l2_failed`） |

要点：

- 寒暄整句 → `trivial` + `maxSteps: 0`（不进 L2；app 可本地短路）
- 其余 → `defer_to_l2`（`band=unknown`）；**交 L2 拍板** band / tools
- L2 **不是**意图分类器：不做「用户想干什么」的开放域 NLU；只产出可执行 policy
- 拉群仅 `hintUserCreateGroup`（UI）；Agent 多智能体用 `allowSubAgents`
- app `chat.service` 注入 L2 模型（弱模名偏好，否则回退 Agent 模型）

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

- `@langchain/core` — L2 `SystemMessage` / `HumanMessage` 调用
- `zod` — L2 `L2Judgement` 校验
