# 决策笔记：Harness 最小可验证从 common → observability → models 起建，模型网关直连 fetch

状态：已落地

## 背景

`packages/chatvein/*` 此前只有空壳版本常量，而 app 主进程已直连 OpenAI 兼容 `/chat/completions`。若继续在 Electron 壳里扩对话能力，会与「能力全在纯 Node 包、零 electron」红线冲突，也难做 vitest。需要先落一条**可单测、可被 CLI/后续 sidecar 复用**的最小链路，而不是一次铺开 orchestrator / groups / Cordis 装配。

## 决策

按依赖顺序交付三包最小实现（注释仅标非显而易见的约束，中文）：

1. **`@chatvein/common`**：`TokenUsage` / `TokenStat` / `Budget` / `TraceEvent` / `ChatModelLike`+`ModelResult`，以及 `ChatveinError` 族。跨包只依赖这些接口与类型，不提前塞满 `Task`/`GraphState` 全量 schema。
2. **`@chatvein/observability`**：`EventBus` + `initRunDir` + `JsonlTraceWriter` + `TraceSink`。事件追加写 `runs/<runId>/trace.jsonl`；超限 payload 外置到 `payloads/` 并写 `payloadRef`。PGlite 依赖已在 package.json，**本期不启用**（查询层后置）。
3. **`@chatvein/models`**：
   - `OpenAICompatibleChatModel`：原生 `fetch` 打 `{baseUrl}/chat/completions`，实现 `ChatModelLike`；
   - `MeteredChatModel`：装饰计量，累加 `TokenStat`；
   - `ModelRouter`：`strong|medium|weak` 分档，可重试错误沿备用链降级并回调 `onFallback`。

验收：三包 `build` + vitest 全绿（mock 网关覆盖成功/429、计量累加、降级）。**尚未**把 `app/src/main/chat` 切到本包——壳侧直连仍临时存在。

## 备选方案

**先搭 Cordis `@chatvein/core` 再写能力**：没有 models/obs 时挂空插件无法验证端到端价值，装配层空转。先能力、后门面。

**模型层一期就用 `@langchain/openai` ChatOpenAI**：依赖选型允许适配层用 LangChain，但方案风险 R1 要求关键路径可绕过框架。直连 `fetch` 更易 mock、零框架开销；LangChain 适配可在 orchestrator 接入时再加，且仍应对齐 `ChatModelLike`。

**Observability 一上来用 PGlite 存 trace**：JSONL 追加写足够「能看见事件」；PGlite 适合事后查询/报告，引入 WASM 与 schema 会拖慢最小闭环。

**同步改造 app chat 走 `@chatvein/models`**：正确终点，但会把「能力包可测」与「IPC/UI 回归」绑死。先包内单测绿，再单独立项替换主进程直连。

## 影响

- 收益：harness 首次有可引用的类型契约、可落盘 trace、可 mock 的模型网关；后续 tools/context/orchestrator 有明确挂点。
- 代价 / 放弃：`Task`/`GraphState`/`ForgeConfig` 等 M0-6 全量类型未一次写完；app 对话与 models 暂双轨；LangChain 适配未做；无并发信号量（可在 Router 外包一层）。
- 后续注意：app `chat.service` / `model.service` 测试连接应收口到 `OpenAICompatibleChatModel`；降级事件应经 `TraceSink.emit('model_fallback')` 落盘；启用 PGlite 时保持 JSONL 为权威追加源或明确双写策略。
