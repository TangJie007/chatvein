# `@chatvein/models`

OpenAI 兼容模型网关：直连 fetch 适配、分档路由与降级链、用量计量、并发信号量。

**双路径：**

- `ChatModelLike` + fetch：可单测、可绕开框架（关键路径）
- `createLangChainChatModel` → `@langchain/openai` `ChatOpenAI`：给 LangGraph（`orchestrator` / `agents`）用

**不负责：** Token 预算熔断（在 `@chatvein/context` 的 BudgetGuard）。
