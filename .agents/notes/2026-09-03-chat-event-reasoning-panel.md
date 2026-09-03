# 决策笔记：chat:event 流式思考事件与右侧思考面板

状态：已落地

## 背景

聊天页右侧原本有一个「思考流」侧栏（`app/src/renderer/components/chat/ThinkingPanel.vue`），但在 ChatView 从静态 mock 重写为接真实 IPC 的那次提交里，两列布局与 `<ThinkingPanel>` 挂载被整段删除，组件成了零引用孤儿；同时主进程 `ChatService.complete()` 是非流式请求（`stream: false`），只取 `message.content`，模型的推理字段（DeepSeek `reasoning_content` / OpenAI 兼容 `reasoning`）被直接丢弃。结果是：对话框旁边没有思考框，即使接回去也没有真实数据可显示。

## 决策

- **恢复右侧固定思考面板**：`ChatView.vue` 的 `<main>` 改为 `grid-template-columns: minmax(0,1fr) auto` 两列，右列挂载 `<ThinkingPanel>`（宽度 260px）。
- **主进程改流式 SSE 调用**：`app/src/main/chat/chat.service.ts` 的 `complete()` 以 `stream: true` 请求 `/chat/completions`，逐行解析 `data:` 帧；`delta.content` 累积为正文（一期仍整体返回，不做正文流式渲染），`delta.reasoning_content ?? delta.reasoning` 作为思考增量经回调上抛。
- **新增主→渲染事件通道 `chat:event`**：`ChatController` 用 `@IpcEmit('event')`（目标窗 `main`）推送 `ChatStreamEvent`；`ChatService.send(input, emit?)` 接收事件回调。事件类型定义在主进程 `chat.types.ts` 与渲染层 `ipc-api.ts`（两处手工保持一致）：
  - `run_start { runId, conversationId, agent, ts }`
  - `thinking_delta { runId, conversationId, delta }`
  - `thinking_done { runId, conversationId }`
  事件广播到主窗口，渲染层按 `conversationId === currentId` 过滤，切会话不串。
- **渲染层在 `useChat` 模块级订阅一次** `api.on('chat:event', ...)`，用模块级 `reactive` 的 `thinking` 状态（`active / phase('thinking'|'answering') / runId / conversationId / agent / text`）按 `runId` 累积思考文本；`send()` 的 `finally` 里置 `active=false` 收起面板。
- **`ThinkingPanel` 改为消费真实状态**：删除硬编码 mock 想法文案与假的「上下文 8.2k/128k」用量条；无 reasoning 时显示「正在梳理思路…」占位，空闲时显示引导文案；思考文本流式追加时贴底滚动。

## 备选方案

**只把面板挂回去、继续喂 mock 数据**：能立刻看到框，但展示的是假思考，属于掩盖问题；且后端不发任何事件，面板永远不会反映真实运行。否决。

**一次性落地 docs/design/08 的完整流式方案**（`ChatEvent` 入 `@chatvein/common`、`@chatvein/service` 的 `runChat(): AsyncGenerator<ChatEvent>`、正文 token 流式 + `MarkdownText`、`AgentTrace` 时间线）：这是终态方向，但 `@chatvein/service`/`orchestrator` 等包目前还是空壳，正文流式还依赖 markdown-it/dompurify/shiki 一整套渲染设施，工作量是一个特性而非一次修复。本次只先打通「思考」这一条事件链路，正文流式与 Markdown 仍按 08 文档 M4–M5 后续推进。

**按 08 文档 §6 用气泡内 `AgentTrace` 折叠时间线呈现思考**：`AgentTrace` 是「步骤（think/tool/rag）时间线」，其数据要来自 ReAct/LangGraph 循环的 step 事件，而当前一期没有 agent 循环（`ChatService` 是单轮补全）；且用户要的是「对话框旁边的框」，即右侧侧栏形态。故本次恢复侧栏 `ThinkingPanel`；`AgentTrace` 待 agent 循环落地、有结构化 step 事件后再接入。

**非流式调用、仅在返回后一次性显示 reasoning**：多数 OpenAI 兼容供应商在非流式响应里不回传 reasoning（或只在流式 delta 中给），且一次性返回没有「实时思考」的体验。流式 SSE 是拿到 reasoning 增量的唯一可靠途径。

## 影响

- 收益：思考面板复活且显示**真实**推理流；`chat:event` 通道与「主进程推事件、渲染层按 runId/conversationId 归并」的模式跑通，为 08 文档的完整 `ChatEvent` 协议铺了路（事件形状是其子集）。
- 代价 / 放弃：正文仍在流结束后一次性出现（与修复前体感一致），正文逐字流式 + Markdown 渲染尚未做；SSE 解析逻辑目前落在 `app/main`，按「能力在 `@chatvein/*`」红线，后续 harness 的 `@chatvein/models`/`@chatvein/service` 成型后应把流式归一上移，app 只传事件 sink；非推理模型（不返回 reasoning）面板只有「正在梳理思路…」占位，属预期。
- 后续注意：`ChatStreamEvent` 在主进程与渲染层各定义一份，字段变更需两处同步（待 `@chatvein/common` 承载协议后改为单一来源）；思考文本目前只存内存、不落库，刷新后历史消息无思考内容（与 08 文档「历史消息一次性定稿渲染」一致，后续可考虑持久化）。
