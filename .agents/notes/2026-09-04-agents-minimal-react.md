# 决策笔记：agents 最简 ReAct（createReactAgent）落地

状态：已落地

## 背景

Chat 对话最终应由 `@chatvein/agents` 驱动；此前仅有包骨架，app 仍主进程 fetch 直连。需要先在能力包内打通「用户消息 →（可选工具）→ 回答」的最简 ReAct，且不得手写 while 循环。

## 决策

- **`@chatvein/models`**：`createLangChainChatModel(OpenAICompatibleConfig)` → `ChatOpenAI`（`configuration.baseURL`），与 `OpenAICompatibleChatModel` fetch 路径并存。
- **`@chatvein/agents`**：`createReactChatAgent` / `invokeReactChatAgent` 薄封装 LangChain **`createAgent`**（在 LangGraph 上跑 ReAct；替代已弃用的 `createReactAgent`）；`defineAgentTool` 用 zod 定义工具。
- 单测用 `FakeListChatModel` 模拟 tool_calls → ToolMessage → 最终 AIMessage，不打真实网关。
- **本轮不切 app** `chat.service`（留 CP1-5）；`@chatvein/tools` 正式工具集未实现时由调用方传入 LangChain tools。

## 备选方案

**手写 tool-calling while 循环**：与设计红线「不自研 Agent 循环」冲突，否决。

**agents 内直接 `new ChatOpenAI`**：会绕过 models 网关约定；桥接放在 models，agents 只接收 `LanguageModelLike`。

**本轮就替换 app chat.service**：产品 IPC/流式未就绪，先库内闭环再切 UI，降低双轨风险。

## 影响

- 收益：CP0-2/CP0-3 可验收；对话运行时有明确 API。
- 代价：`tools` 包仍空，真实读文件等工具需后续接入；app 仍临时直连。
- 后续注意：CP0-4 角色加载、CP0-5 trace、CP1 `astream` → `ChatEvent`。
