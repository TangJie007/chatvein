# 流式对话与 Markdown 渲染方案

> 版本：v1.0 ｜ 日期：2026-09-03  
> **决策状态：已锁定（选型）**  
> 上位：[`../phase1/02-方案设计.md`](../phase1/02-方案设计.md)、[`./02-agent循环方案.md`](./02-agent循环方案.md)  
> 关联：[`./01-核心骨架.md`](./01-核心骨架.md)（对话 / 群组）、[`./06-插件运行时-Cordis.md`](./06-插件运行时-Cordis.md)

---

## 1 决策摘要

| 关注点 | 选定 | 说明 |
|--------|------|------|
| **流式来源** | LangGraph `graph.astream(input, { streamMode })` | 不引第三方「流式库」，harness 已用 LangChain/LangGraph |
| **streamMode** | `["messages", "updates", "custom"]` | messages=逐 token 且带 `langgraph_node`（区分哪个 Agent 在说）；updates=节点/工具状态；custom=护栏/handoff 等应用事件 |
| **进程间传输** | IPC 离散事件（`webContents.send`） | Electron IPC 不能传 Node Stream；主进程把 AsyncGenerator 归一成事件帧，token 合批（~16–50ms） |
| **事件协议** | `ChatEvent` 联合类型，放 `@chatvein/common` | 主/渲染共享类型；run 以 `runId` 归并 |
| **执行过程 UI** | 结构化事件时间线（`AgentTrace`） | 思考/工具/护栏/handoff 与「最终回答 Markdown」**分开渲染** |
| **Markdown 解析** | **`markdown-it`** | 与 VSCode/Cursor 同引擎；Vue 社区主流；插件生态全 |
| **代码高亮** | **Shiki**（默认）/ highlight.js（降级） | Shiki 为 VSCode 级 TextMate 高亮；流式期最后一块先纯文本，定稿再高亮 |
| **HTML 消毒** | **`dompurify`** | 走 `v-html`，工具返回 / RAG 片段不可信，必须消毒 |
| **流式渲染策略** | 累积全量重解析 + rAF 节流 + 配对符补全 + 定稿重渲染 | 不做增量解析；见 §5 |
| **取消** | `AbortSignal` + IPC `chat:cancel` | 贯穿 LangGraph astream |

> 红线不变：**能力（对流式的归一、事件发射）在 `@chatvein/*`；`app` 只是调用者与渲染者。** Markdown 渲染属于纯渲染层，依赖只加在 `app`（renderer），不进 harness。

---

## 2 为什么不引「流式库」

- harness 已依赖 `@langchain/openai`（`@chatvein/models`）与 `@langchain/langgraph`（`@chatvein/orchestrator`）。模型 `model.stream()` / 图 `graph.astream()` 原生产出 token 增量与节点更新，再包一层 SSE 库（如 `eventsource`/`ai-sdk`）属于重复抽象，且与 LangGraph 的多 Agent 元数据不贴合。
- 桌面端没有 HTTP/SSE：Electron 主进程持有 LangGraph 运行时，渲染进程经 IPC 拿事件。因此**真正要设计的是「事件协议 + IPC 通道 + 渲染层状态归并」**，而不是传输库。
- 市面参照：React 派（NextChat/LobeChat/Dify）用 react-markdown + SSE；**非 React 桌面派（VSCode/Cursor）用 markdown-it**，流式层各自实现。我们属后者。

---

## 3 事件协议（`@chatvein/common`）

一次对话运行（run）以 `runId` 归并；多 Agent 群聊中每帧带 `agent` 标识（来自 LangGraph 的 `langgraph_node`）。

```ts
export type ChatEvent =
  | { type: 'run_start'; runId: string; agent: string; ts: number }
  // 逐 token（agent = 当前发言角色；群组里用于分流到对应气泡）
  | { type: 'token'; runId: string; agent: string; delta: string }
  // 执行步骤：思考 / 工具调用 / 检索
  | { type: 'step'; runId: string; id: string; kind: 'think' | 'tool' | 'rag'
      name: string; status: 'running' | 'ok' | 'warn'; tag?: string; detail?: string }
  // 护栏拦截（写入二次确认等），run 进入 blocked，等用户选择
  | { type: 'guard'; runId: string; title: string; detail: string; choices: string[] }
  // 群组内 Agent 交接
  | { type: 'handoff'; runId: string; from: string; to: string; note: string }
  // 单条 agent 消息正文结束（触发 Markdown 定稿渲染）
  | { type: 'message_done'; runId: string; agent: string }
  // 整轮结束：用量 / 费用 / 耗时
  | { type: 'run_done'; runId: string; usage: { tokens: number; cost: number; ms: number } }
  | { type: 'error'; runId: string; message: string }
```

LangGraph 三种 streamMode 到事件的映射：

| LangGraph | 映射为 | 用途 |
|-----------|--------|------|
| `streamMode: 'messages'` | `token` / `message_done` | 正文流水；`msg.lc_kwargs` / `langgraph_node` 给出角色 |
| `streamMode: 'updates'` | `step`（节点开始/完成、工具返回） | trace 时间线、状态 pill |
| `streamMode: 'custom'`（`getStreamWriter()`） | `guard` / `handoff` / 业务告警 | 护栏、交接、预算超限 |

---

## 4 IPC 通道与主进程编排

Electron IPC 是「请求/响应（invoke）」+「单向推送（send/on）」。流式用**一次性 invoke 起任务 + 持续 send 推事件**：

| 通道 | 方向 | 说明 |
|------|------|------|
| `chat:start` | renderer → main（invoke） | 入参 `{ runId?, agentId/groupId?, input, context }`；返回 `{ runId }` |
| `chat:event` | main → renderer（send） | 推 `ChatEvent`；**token 帧在主进程按 ~16–50ms 合批**后发，避免 IPC 风暴 |
| `chat:cancel` | renderer → main（send/invoke） | 触发该 run 的 `AbortController.abort()` |

主进程（经 `@chatvein/service` 的 Cordis 服务）伪代码：

```ts
async function* runChat(input): AsyncGenerator<ChatEvent> {
  const stream = graph.astream(input, {
    streamMode: ['messages', 'updates', 'custom'],
    signal: ac.signal,
  })
  for await (const [mode, data] of stream) yield* mapToChatEvent(mode, data)
}
// webContents.send('chat:event', evt)；token 用 buffer + setTimeout(rAF 等价) 合批
```

> 注意：`@chatvein/service` 只负责把 `AsyncGenerator<ChatEvent>` 跑起来并通过注入的「事件 sink」推帧；**不依赖 Electron**，便于日后换 Web/HTTP 出口。Electron 的 `webContents.send` 是 app 侧传入的 sink 实现。

---

## 5 流式 Markdown 渲染

### 5.1 选型

| 库 | 职责 | 备注 |
|----|------|------|
| `markdown-it` | MD → HTML | `html:false`（不直接放行模型 HTML）、`linkify`、`breaks`；配 `markdown-it-task-lists` 等 |
| `shiki` | 代码高亮 | VSCode 级；异步、较重 → 见 5.3 |
| `highlight.js` | 代码高亮（备选/降级） | 同步、轻、容错好；`highlight(str,{language})` 半截代码也能高亮 |
| `dompurify` | HTML 消毒 | `v-html` 前 `DOMPurify.sanitize(html)` |

依赖加在 **app renderer**（`app/package.json`），不进入 `@chatvein/*`。

### 5.2 核心策略：累积全量重解析（不做增量解析）

markdown-it 是**无状态整文档解析器**。token 只 append 到 buffer，每次渲染拿「累积完整字符串」从头 `md.render()`：

- 一条消息通常几 KB，全量重解析是毫秒级，开销可忽略；
- markdown-it 对「没写完」本就宽容：**未闭合围栏 ``` 会把到文末的内容当代码块**（正是想要的流式效果）；未闭合 `**`/链接先按字面量渲染，下一 tick 自动修正，不报错。

四件工程动作：

1. **累积 + 节流**：`requestAnimationFrame`（或 50ms throttle）触发渲染，每帧最多一次；
2. **渲染副本补配对符**（不改原始 buffer）：围栏 ``` 奇数个补 ` ``` `、行内反引号奇数补 `` ` ``、`**` 奇数补 `**`，消除抖动/让高亮器拿到完整结构；
3. **最后一块代码的高亮特殊处理**：已闭合块正常高亮（结果按内容 hash 缓存）；**正在流式的最后一块先纯文本**，定稿再高亮（Shiki 异步尤需如此；hljs 可直接高亮）；
4. **定稿渲染**：收到 `message_done` 再跑一次完整 `md.render()`（围栏闭合、Shiki 补齐、插件全生效）替换流式内容。

### 5.3 组件草案 `<MarkdownText>`

```vue
<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue'
import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'
// import hljs from 'highlight.js/lib/core'  // 降级方案
// shiki 高亮在 highlight 回调中按 hash 缓存、最后一块流式期间跳过

const props = defineProps<{ text: string; streaming?: boolean }>()
const md = new MarkdownIt({ html: false, linkify: true, breaks: true /* , highlight */ })
const html = ref('')
let raf = 0

function balance(src: string) {          // 补配对符，仅用于渲染副本
  let out = src
  if ((src.match(/```/g) ?? []).length % 2 === 1) out += '\n```'
  if ((src.match(/(?<!`)`(?!`)/g) ?? []).length % 2 === 1) out += '`'
  if ((src.match(/\*\*/g) ?? []).length % 2 === 1) out += '**'
  return out
}
function render() {
  const src = props.streaming ? balance(props.text) : props.text
  html.value = DOMPurify.sanitize(md.render(src))
}
watch(() => props.text, () => {
  if (props.streaming) { cancelAnimationFrame(raf); raf = requestAnimationFrame(render) }
  else render()                           // message_done：立即定稿
}, { immediate: true })
onBeforeUnmount(() => cancelAnimationFrame(raf))
</script>

<template>
  <div class="md-body" v-html="html" />
</template>
```

配套体验：流式期气泡末尾挂闪烁光标块；滚动**贴底锚定**（用户在底部才自动滚，手动上翻不强制拉回）。

---

## 6 执行过程的呈现形态

原则：**过程是结构化事件，结果是 Markdown 正文，二者分离。**

| 事件 | UI 形态（沿用现有组件） |
|------|------------------------|
| `token` | 追加到当前 agent 气泡的 `<MarkdownText :streaming>` |
| `step(think/tool/rag)` | `AgentTrace` 时间线：图标 + 步骤名 + 耗时/参数摘要；状态 pill `● 正在执行 · 第 3/5 步` → `✓ 完成` |
| `guard` | 黄色护栏卡（`GuardrailAlert`）+ 选择按钮；run 置 `blocked`，等待回传选择后继续 |
| `handoff` | 群组内 `A → B 交接` 胶囊条 |
| `run_done` | trace 折叠为一行摘要（耗时 / tokens / 费用）；正文定稿 |

- 执行中 trace 默认展开、完成后默认折叠；agent 气泡只放「它说的话」，工具调用不塞进正文。
- 渲染层用轻量 `reactive` store 按 `runId` 累积事件（不引 Pinia 也可，一个 `reactive<Map>` 足够）。
- 现有 mock 组件 `AgentTrace.vue` / `GuardrailAlert.vue` / `ChatMessage.vue` 改为**消费事件 store**，数据由 `data/chat.ts` 的静态 mock 切换为 IPC 事件。

---

## 7 依赖与落点

| 包 | 加在哪 | 依赖 |
|----|--------|------|
| 事件类型 `ChatEvent` | `@chatvein/common` | 无 |
| `runChat()` 流式归一 | `@chatvein/service`（Cordis 服务，经 `ctx` 暴露） | `@chatvein/orchestrator`、`@chatvein/models` |
| IPC 通道 `chat:start/event/cancel` | `app/main`（controller）+ `app/preload` | `@electrum/*` |
| Markdown 渲染 | `app/renderer` | `markdown-it`、`dompurify`、`shiki`（或 `highlight.js`）、`@types/markdown-it`、`@types/dompurify` |

> 版本记入 [`../phase1/04-依赖选型.md`](../phase1/04-依赖选型.md)。

---

## 8 实施顺序（WBS 建议）

1. **M1 协议**：`@chatvein/common` 定义 `ChatEvent`；单测覆盖映射。
2. **M2 归一**：`@chatvein/service` 实现 `runChat(): AsyncGenerator<ChatEvent>`，消费 LangGraph `astream` 三种模式；`AbortSignal` 取消。
3. **M3 IPC**：app 主进程 `chat:start/event/cancel`；token 合批；preload 暴露 `onChatEvent`。
4. **M4 渲染 store + trace**：事件归并 store；`AgentTrace`/`GuardrailAlert` 接事件；护栏选择回传。
5. **M5 Markdown**：`MarkdownText`（markdown-it + dompurify + shiki/hljs）；流式补配对符、定稿渲染、贴底滚动。
6. **M6 联调**：单 Agent 对话 → 群组多 Agent（按 `agent` 分气泡）→ 取消/护栏中断恢复。

---

## 9 边界与待定

- **Shiki vs highlight.js**：默认 Shiki（观感优先，Electron 本地无网络请求）；若包体/首屏敏感，切 highlight.js 仅改高亮回调，接口不变。
- **token 合批阈值**：16ms（≈一帧）起步，弱机/大输出可调到 50ms；以 IPC 消息数与流畅度平衡为准。
- **Markdown 内原始 HTML**：一期 `html:false` + DOMPurify 双保险；若后续要支持模型产出受信 HTML 片段，再按白名单放开。
- **历史消息**：流式策略仅针对进行中的 run；已落库消息一次性定稿渲染即可。
