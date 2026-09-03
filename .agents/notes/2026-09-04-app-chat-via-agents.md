# 决策笔记：app 对话切到 @chatvein/agents

状态：已落地

## 背景

对话页曾用主进程 `fetch` 直连 OpenAI 兼容接口（含 SSE reasoning）。`@chatvein/agents` 已有最简 ReAct（`createAgent`），需按 CP1-5 删除双轨，让产品对话与能力包一致。

## 决策

- `app/src/main/chat/chat.service.ts` 的 `send()` 改为：
  - `createLangChainChatModel`（`@chatvein/models`）
  - `createReactChatAgent` + `invokeReactChatAgent`（`@chatvein/agents`）
- 删除主进程内的 SSE `/chat/completions` 实现。
- app 只依赖 `@chatvein/agents` / `@chatvein/models`，**不**直接 import `@langchain/*`。
- 工具暂传 `[]`（角色 tools 白名单未落地）；思考面板推送「ReAct 运行中」状态，流式 token/reasoning 留 CP1-2。

## 备选方案

**继续保留 fetch 双轨直到 astream 就绪**：会延长两套调用路径，易漂移；先切同步 invoke，体验可接受。

**app 直接 import langchain createAgent**：违反「编排留在能力包」红线。

## 影响

- 收益：对话与 agents 包统一；可随后加工具/流式而不再改调用入口。
- 代价：暂无 SSE reasoning 增量；非流式整段返回；无 usage 计量回填。
- 后续注意：CP1-2 `astream` → `ChatEvent`；接 `agent.tools` 白名单与 `@chatvein/tools`。
