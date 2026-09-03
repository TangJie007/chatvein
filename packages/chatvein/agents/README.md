# `@chatvein/agents`

Chat 产品轨的 **Agent 运行时**：LangGraph **`createReactAgent`**（ReAct）+ 工具绑定。普通对话与群成员单次发言都由本包驱动。

## 最简 ReAct（已落地）

```ts
import { createLangChainChatModel } from '@chatvein/models'
import {
  createReactChatAgent,
  defineAgentTool,
  invokeReactChatAgent,
} from '@chatvein/agents'
import { z } from 'zod'

const llm = createLangChainChatModel({
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
  llm,
  tools: [echo],
  systemPrompt: '你是助手，需要时可调 echo。',
})

const { content } = await invokeReactChatAgent(agent, { message: '你好' })
```

- **不自研** ReAct while 循环，直接用 `@langchain/langgraph/prebuilt` 的 `createReactAgent`。
- 模型：生产用 `createLangChainChatModel`（`ChatOpenAI` 桥接）；单测用 `FakeListChatModel`。
- app 的 `chat/*` 只应调本包（经 core），不得内嵌 LangGraph。切流式 / IPC 见 CP1、[`docs/design/08`](../../../docs/design/08-流式对话与Markdown渲染.md)。
