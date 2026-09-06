# `@chatvein/observability`

可观测：**统一遥测核心**（`telemetry.ts`）+ 运行事件总线 + `trace.jsonl` 落盘（大 payload 外置为 `payloadRef`）+ 运行目录布局。Forge 任务图、对话 ReAct、群消息、LLM 原始 IO 都往这里打事件；UI 订阅同一通道。不负责编排或模型调用。

## 统一遥测核心

所有埋点（含原 models 包的 `llm_debug`）收敛到 `telemetry.ts`：

- **事件名带命名空间**：模型原始 IO 统一为 `llm:request` / `llm:response` / `llm:error`（来源由 `attrs.source` 区分：`langchain` 探针 / `openai-compatible` 直连）；业务编排/度量用 `trace:*`（如 `trace:react:request`、`trace:tool_select`、`trace:memory:short-term`）。一次模型调用的三条事件用同一 `spanId`（LangChain runId 或直连生成的 uuid）关联，`traceId` 由请求上下文注入；response/error 带 `durationMs`、`status`，token 用量在 `attrs.tokens`。
- **业务字段挂 `payload`**；信封字段对齐主流方案（OpenTelemetry / OpenInference）：`id / ts / name / traceId / spanId / parentSpanId / status / durationMs / attrs / payload / error`。
- **落在哪由业务决定**：业务通过 `setTelemetrySink(cb)` 注入一个回调。现阶段 app 注入「经 IPC 推渲染进程 `console.log`」；未来可换 JSONL（`JsonlTraceWriter`）/ PGlite，事件生产方无需改动。
- 未注入 sink 时，开关打开则回落当前进程 `console.log`（脚本/单测）。

```ts
import { emitTelemetry, setTelemetrySink, setTelemetryContext } from '@chatvein/observability'

// 业务：决定数据落点（现阶段 = 推渲染进程 console）
setTelemetrySink((event) => forwardToRenderer(event))
// 请求级上下文：自动给每个事件补 traceId / 通用 attrs
const clearCtx = setTelemetryContext({ traceId: runId, attrs: { conversationId } })

// 生产方：只关心「打什么」，业务字段进 payload
emitTelemetry('trace:tool_select', { selector, candidateCount, narrowedCount, tools })
// LLM 原始 IO（models 包的 LlmTelemetryCallbackHandler / 直连模型内部已发，无需手写）
emitTelemetry('llm:request', { messages, invocationParams }, { spanId, attrs: { source: 'langchain' } })

clearCtx()
```

## 开关

- 默认开：`NODE_ENV` 含 `development/dev`，或存在 `ELECTRON_RENDERER_URL`。
- 强制开/关：`CHATVEIN_TELEMETRY=1|0`（兼容旧名 `CHATVEIN_LLM_DEBUG`，显式设置的旧变量优先）。

## 持久化（后置/可选）

`TraceSink` + `JsonlTraceWriter` 提供 `runs/<runId>/trace.jsonl` 落盘与大 payload 外置（`payloads/<id>.json`）。需要跨 run 聚合落盘时，把它包成一个 sink 传给 `setTelemetrySink` 即可。
