# 决策笔记：每次 LLM 调用打印入参/出参

状态：已落地

## 背景

仅有 `react:request` / `react:response` 时，只能看到整轮 ReAct 的入口与最终轨迹，看不到中间每一步（含 L2 分类、工具循环内的每次 ChatModel 调用）真正发给网关的消息与返回。调试 tool-calling 与路由灰区需要逐步对照。

先前曾把 LangChain debug 回调默认挂上，导致 ReAct `invoke` 卡住、发送无响应；因此约定：**禁止无条件自动挂回调**，须显式 sink，且回调不得阻塞模型调用。

## 决策

- `@chatvein/models` 的 `DevLlmLogCallbackHandler` 在 `handleChatModelStart` / `handleLLMStart` 发 `langchain:request`，在 `handleLLMEnd` / `handleLLMError` 发 `langchain:response` / `langchain:error`；消息经 `summarizeMessagesForDebug` 摘要，内容截断。
- `awaitHandlers = false`，实际写出走 `setImmediate`，并在回调当下**捕获** sink 闭包（避免 `finally` 清掉 `activeSink` 后丢日志）。
- Electron `ChatService`：每轮 `send` / `regenerate` 用 `setLlmDebugSink` 挂请求级 sink → `llm_debug` IPC；`createLangChainChatModel(..., { onLlmDebug: forwardToActiveLlmDebugSink })` 始终挂转发（无 activeSink 为空操作），这样缓存的 L2 模型在后续打开 debug 仍能出逐步日志。
- 仍保留整轮 `react:request` / `react:response`；逐步日志是补充，不是替代。

## 备选方案

### 为什么不用 ALS（AsyncLocalStorage）贯穿整轮？

`runWithLlmDebugLog` 仍可用于 CLI/单测。Electron 主进程里 LangChain 回调与 invoke 的 promise 边界曾让 ALS 不可靠；请求级 `setLlmDebugSink` + 闭包捕获更直观，且与「禁止默认挂回调」一致。

### 为什么不在网关 HTTP 层拦请求体？

`ChatOpenAI` 的 wire body 与 LangChain 内部消息不同；产品调试更需要「模型看到的 messages / generations」。HTTP 抓包留给外部工具。

### 为什么不把逐步日志写进助手气泡？

体积大、含中间 tool 轨迹，适合 DevTools `console.log([chatvein:llm:…])`，不适合 UI 常驻。

## 影响

- 开启 `CHATVEIN_LLM_DEBUG`（或开发态默认）且有 stream emit 时，控制台会出现多次 `langchain:request` / `langchain:response`，噪声变大但可对照每跳。
- L2 与 ReAct 共用同一 activeSink；并发多会话时 sink 是进程级单槽，一期假设单用户串行发送。
- 热重载后若 L2 仍是旧实例（未带 callback），需换模型 id 或重启一次以重建。
