# coder-agent 设计文档：把「市面最成熟的 coding agent」落到本仓库

- 位置：`packages/chatvein/agents/docs/coder-agent-design.md`
- 状态：设计稿（当前 `coder-agent/agent.ts` 仍是 LangGraph 占位骨架，节点直接抛「未实现」）
- 关联：`chat-agent`（`createAgent` on LangGraph）、`router-agent`（L1/L2 路由）、`tools-filter-agent`、`@chatvein/filesystem`（`deepagents` 文件系统中间件）、`@chatvein/tools`
- 遵循仓库红线：**优先成熟第三方，不重复造轮子**（`.cursor/rules/prefer-third-party.mdc`）

---

## 1. 目标与非目标

### 目标

把「市面上最成熟的 coding agent」形态，落成本仓库 `coderAgent` 的**可用实现**，替换现有占位骨架，并与既有路由 / 工具筛选 / 记忆 / 沙箱链路无缝对接。

一个成熟 coding agent 的能力清单（下文第 2 节论证）：

1. **代理循环（Agentic loop / ReAct）**：模型自主决定「读→改→跑→看结果→再改」，直到收敛。
2. **规划（Planning / TODO）**：把大任务拆成可勾选步骤，长任务不跑偏。
3. **文件系统工具**：`read_file / write_file / edit_file / ls / glob / grep`。
4. **命令执行**：在受控沙箱里跑 shell（装依赖、构建、测试）。
5. **验证闭环（Verify loop）**：跑 build / lint / test，把失败输出喂回模型自我修复。
6. **子代理 / 上下文隔离（Sub-agents）**：把「查资料 / 大范围搜索」等噪声任务丢给隔离上下文的子代理，主线程上下文保持干净。
7. **上下文管理（Compaction）**：长会话自动摘要 / 压缩，避免爆窗。
8. **权限与安全**：写操作、危险命令有边界（路径白名单、审批模式、沙箱隔离）。
9. **持久化 / 短期记忆**：跨轮恢复（checkpointer + thread）。

### 非目标

- 不重写一套 agent 框架 / 循环 / 网关（红线：能力包已有 API 时只调用）。
- 不在本包内实现 UI、审批弹窗、终端渲染（那是 `app` 侧职责）。
- 不做真正的远程云沙箱（先用本地工作区受控目录，云沙箱作为后续 backend 扩展点）。

---

## 2. 市面成熟 coding agent 的共性架构（选型依据）

| 产品 | 循环 | 规划 | 文件工具 | 命令执行 | 子代理 | 上下文压缩 | 权限模型 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Claude Code | ReAct | TODO | ✅ | ✅ 沙箱 | ✅ Task | ✅ 自动 compaction | 逐操作审批 / 白名单 |
| OpenAI Codex CLI | ReAct | 隐式 | ✅ | ✅ 沙箱 | — | ✅ | approval mode |
| Cursor Agent | ReAct | TODO | ✅ | ✅ | ✅ | ✅ | 自动/手动 |
| Aider | 编辑循环 | — | ✅（diff/edit） | ✅ | — | 仓库地图 | git 提交边界 |
| OpenHands / Devin | ReAct | 规划器 | ✅ | ✅ Docker | ✅ | ✅ | 沙箱隔离 |

**共性结论**：成熟 coding agent = 「一个跑在图运行时上的 ReAct 循环」+ 「planning / filesystem / shell / sub-agent 四类内建工具」+ 「上下文压缩」+ 「权限/沙箱边界」。差异只在 UI、审批粒度与沙箱实现，**核心 harness 高度同构**。

### 2.1 关键判断：这套 harness 已经有成熟开源实现 —— `deepagents`

仓库已装 `deepagents@1.13.3`（LangChain 官方出品，"batteries-included agent harness"，MIT），其公开 API 恰好逐条覆盖上表能力：

- `createDeepAgent(...)` → 返回**已编译的 LangGraph 图**（可直接用 checkpointer / streaming）。
- 内建工具：`write_todos`（规划）、`read_file/write_file/edit_file/ls/glob/grep`（文件）、`task`（子代理，隔离上下文）。
- 中间件（可组合）：`createFilesystemMiddleware`、`createSubAgentMiddleware`、`createSummarizationMiddleware`（上下文压缩）、`createSkillsMiddleware`、`createAgentMemoryMiddleware`。
- 后端抽象：`FilesystemBackend`（真实磁盘）、`StateBackend`（图状态里的草稿文件）、`CompositeBackend`（组合）、`LocalShellBackend`（本地 shell）、`BaseSandbox` / `SandboxBackendProtocol`（沙箱扩展点）。
- 权限：`FilesystemPermission`、`PermissionMode`、`FilesystemOperation`。

而且**本仓库已经在用它**：`@chatvein/filesystem` 的定位就是
「`deepagents createFilesystemMiddleware` over a `CompositeBackend`（`FilesystemBackend` for `/workspace`，`StateBackend` for drafts）」。

> **决策**：coder-agent 的核心循环采用 `deepagents.createDeepAgent`，**不自研** StateGraph 编码循环。这与 `chat-agent` 直接用 LangChain `createAgent` 的既有取舍完全一致（见 `chat-agent/agent.ts` 注释：「对外只暴露简单接口，不自研循环」），也满足红线第 1/4 条。

被否决的自研路线见第 9 节。

---

## 3. 在本仓库中的定位与调用链

coder-agent 是 `@chatvein/agents` 里与 `chatAgent` 平级的一个 **Cordis 插件服务**（`ctx.coderAgent`）。宿主（`app`）不改分发范式：

```
用户消息
  │
  ▼
ctx.routerAgent.analyze()            // 已有：L1/L2，产出 plan（isCoding / band / tools / tier / maxSteps）
  │  plan.suggestedTarget === 'coder'
  ▼
ctx.toolsFilter.filter()             // 已有：从候选工具全集挑本轮子集（可选，见 3.2）
  │
  ▼
ctx.coderAgent.invoke({              // 本设计：把循环换成 deepagents
    model, tools, systemPrompt,
    backend / filesystemMiddleware,  // 来自 @chatvein/filesystem
    checkpointer, threadId,          // 来自 ChatMemoryService（SqliteSaver）
    recursionLimit, signal,
  })
  │
  ▼
最终回答 + 完整消息轨迹（含 ToolMessage / TODO / 文件改动）
```

**关键：对外接口尽量与 `chatAgent` 对齐**，宿主几乎零改动即可从 chat 切到 coder。

### 3.1 与 router-agent 的衔接

`router` 的 L2 已经产出 coder 需要的一切调度信号，直接复用、**不新增分类器**：

- `suggestedTarget === 'coder'` → 走 coder-agent。
- `plan.tier`（weak/medium/strong）→ 选模型档。
- `plan.maxSteps` → `recursionLimit`。
- `plan.tools`（none/full）→ 是否挂工具。
- `plan.band === 'complex'` → 允许开子代理 / 提高步数上限。

### 3.2 与 tools-filter-agent 的衔接

coder 的**内建工具（TODO / 文件 / task）由 deepagents 固定提供，不进筛选**。`toolsFilter` 只筛「业务工具」（`@chatvein/tools` 里的 MCP / 检索 / 联网等），筛出的子集作为 `tools` 传给 `createDeepAgent`。

---

## 4. 架构分层

```
┌──────────────────────────────────────────────────────────────┐
│ app（宿主，Electron 主进程）                                    │
│  chat.service → 按 router.plan 分发 → ctx.coderAgent.invoke     │
└───────────────┬──────────────────────────────────────────────┘
                │ Cordis 服务调用
┌───────────────▼──────────────────────────────────────────────┐
│ @chatvein/agents · coder-agent                                 │
│  plugin.ts     CoderAgentService（ctx.coderAgent，现建不缓存）  │
│  agent.ts      createCoderAgent = 薄封装 createDeepAgent        │
│                （消息进 / 文本+轨迹出，接口对齐 chatAgent）     │
│  prompt.ts     编码 persona + 验证纪律 + 安全约束               │
│  verify.ts     构建/测试工具（run_build/run_tests/run_lint）    │
└───────────────┬──────────────────────────────────────────────┘
                │ 复用
┌───────────────▼───────────────┐  ┌───────────────────────────┐
│ deepagents（成熟 harness）      │  │ @chatvein/filesystem       │
│  createDeepAgent               │  │  createFilesystemMiddleware │
│  write_todos / fs tools / task │  │  over CompositeBackend      │
│  summarization / skills mw     │  │  (FilesystemBackend /workspace
│  Filesystem/State/Composite    │  │   + StateBackend drafts)   │
│  LocalShellBackend / Sandbox   │  └───────────────────────────┘
└───────────────┬───────────────┘
                │ LangGraph 运行时
┌───────────────▼───────────────┐
│ @langchain/langgraph           │
│  checkpointer(SqliteSaver) /   │
│  streaming / recursionLimit    │
└────────────────────────────────┘
```

---

## 5. 对外 API 设计（保持与现有接口兼容 + 渐进扩展）

保留现有 `CoderAgent` / `CoderAgentInvokeInput` / `CreateCoderAgentOptions` 形状，只做**加法**（现有 spec 只断言 `model is required` 与图存在，均可继续满足）。

```typescript
// createCoderAgent 选项（在现有基础上扩展）
export interface CreateCoderAgentOptions {
  /** 编码用模型（须支持 tool calling） */
  model: LanguageModelLike
  /** 编码 persona（默认见 prompt.ts） */
  systemPrompt?: string
  /** trace / 多 agent 区分 */
  name?: string

  // —— 新增（全部可选，未传即最小可用） ——

  /** 业务工具子集（来自 toolsFilter；内建 TODO/fs/task 工具由 deepagents 提供，不在此列） */
  tools?: StructuredToolInterface[]
  /**
   * 文件系统能力：直接传 @chatvein/filesystem 装配好的中间件，
   * 或传后端由本包用 createFilesystemMiddleware 包装。
   */
  filesystem?: FilesystemMiddleware | { backend: BackendProtocol }
  /** 是否启用验证工具（run_build/run_tests/run_lint）。默认 true */
  enableVerify?: boolean
  /** 是否允许开子代理（复杂检索/大范围搜索隔离上下文）。默认跟随 band */
  enableSubagents?: boolean
  /** 上下文自动压缩阈值（token / 消息数），透传 createSummarizationMiddleware */
  summarization?: SummarizationOptions | boolean
  /** 状态检查点（跨轮持久化），与 chatAgent 同款 */
  checkpointer?: BaseCheckpointSaver | boolean
  /** 权限模式：'auto' | 'readOnly' | 'approve'（映射 deepagents PermissionMode） */
  permissionMode?: 'auto' | 'readOnly' | 'approve'
}

export interface CoderAgentInvokeInput {
  message: string
  history?: ChatMessage[]
  /** LangGraph 递归上限（对齐 chatAgent）；建议取 router 的 maxSteps */
  recursionLimit?: number
  /** 会话线程 ID → configurable.thread_id（配 checkpointer 用） */
  threadId?: string
  signal?: AbortSignal
}

export interface CoderAgent {
  /** 跑一轮编码循环，返回最终文本 + 完整轨迹（含 TODO / 文件改动 / ToolMessage） */
  invoke(input: CoderAgentInvokeInput): Promise<CoderAgentInvokeResult>
  /** 暴露已编译的 deepagents/LangGraph 图，便于 streaming / 调试 */
  graph: DeepAgent
}

export interface CoderAgentInvokeResult {
  content: string
  messages: BaseMessage[]
  /** 可选：本轮改动的文件列表（从状态或 backend diff 提取，供 UI 展示） */
  changedFiles?: string[]
}
```

### 实现骨架（agent.ts，替换现有占位）

```typescript
import { createDeepAgent } from 'deepagents'
import { extractFinalAssistantText } from '../chat-agent/agent' // 复用，不重写

export function createCoderAgent(options: CreateCoderAgentOptions): CoderAgent {
  if (!options?.model) throw new Error('createCoderAgent: options.model is required')

  const middleware = [
    resolveFilesystemMiddleware(options.filesystem), // 复用 @chatvein/filesystem
    ...(options.enableVerify !== false ? [] : []),   // 验证工具走 tools，不走 mw
    ...(options.summarization ? [createSummarizationMiddleware(...)] : []),
    ...(options.enableSubagents ? [createSubAgentMiddleware(...)] : []),
  ].filter(Boolean)

  const graph = createDeepAgent({
    model: options.model,
    systemPrompt: options.systemPrompt ?? DEFAULT_CODER_PROMPT,
    tools: [...(options.tools ?? []), ...(options.enableVerify !== false ? verifyTools : [])],
    middleware,
    ...(options.checkpointer !== undefined ? { checkpointer: options.checkpointer } : {}),
    // permissionMode / name 透传
  })

  return {
    graph,
    async invoke(input) {
      const messages = toLangChainMessages(input, options.systemPrompt) // 与 chat-agent 同款
      const state = await graph.invoke(
        { messages },
        {
          recursionLimit: input.recursionLimit ?? 64,
          ...(input.signal ? { signal: input.signal } : {}),
          ...(input.threadId ? { configurable: { thread_id: input.threadId } } : {}),
        },
      )
      return {
        content: extractFinalAssistantText(state.messages),
        messages: state.messages,
      }
    },
  }
}
```

> 注意：具体 `createDeepAgent` 参数名 / 中间件签名以 `deepagents` 类型定义为准（`dist/index.d.ts` 已导出 `CreateDeepAgentParams`、`FilesystemMiddlewareOptions`、`SubAgentMiddlewareOptions`、`MemoryMiddlewareOptions` 等），落地时按类型对齐，不臆造。

---

## 6. 内建能力落地细节

### 6.1 规划（write_todos）

deepagents 自带 `write_todos`。系统提示里明确纪律：**开工先建 TODO、每完成一步勾选、卡住时更新计划**。complex band 强约束「先出计划再动手」。

### 6.2 文件系统

直接复用 `@chatvein/filesystem`：`CompositeBackend` = `/workspace`→`FilesystemBackend`（真实会话工作区），草稿→`StateBackend`（图状态内，随 checkpointer 持久）。

- **路径边界**：`FilesystemBackend` 根锁定在「会话工作区目录」（见记忆笔记 `<工作区>/<会话 slug>/`），模型无法越界访问系统其它路径。
- 读大文件走 `read_file` 分页（`normalizeReadPagination`），避免一次性灌爆上下文。

### 6.3 命令执行 + 验证闭环（差异化重点）

这是把「能改代码」升级成「能交付可运行代码」的关键，也是本包**值得自研的差异化薄层**（红线允许：赛事评分闭环 / 沙箱策略属于产品边界）。

- 底层用 deepagents `LocalShellBackend`（或后续沙箱 backend）执行命令，**根目录锁定会话工作区**。
- 在其上封装**受限的高层工具**（`verify.ts`），而不是给模型开放任意 shell：
  - `run_build` / `run_tests` / `run_lint`：跑仓库约定命令，回传**截断后的 stdout/stderr + exit code**。
  - `run_command`（可选，`permissionMode==='approve'` 时需审批）：白名单前缀（`pnpm`/`node`/`tsc`/`vitest`/`git status|diff` 等），拒绝 `rm -rf`、网络下载类危险命令。
- **纪律写进 prompt**：改完必须跑验证；失败则读错误、定位、修复、再验证，直到通过或明确说明无法修复。这就是 Aider/Claude Code 的「edit → test → fix」闭环。

### 6.4 子代理（task）

复杂检索、跨大目录搜索、读长文档 → 用 deepagents `task` 委派给隔离上下文的子代理，只把**结论**带回主线程，保护主上下文预算。默认仅在 `band === 'complex'` 或显式开启时启用（避免小任务多花 token）。

### 6.5 上下文压缩

长编码会话易爆窗 → `createSummarizationMiddleware` 按阈值自动摘要旧消息。阈值默认保守（接近模型窗口上限再压），可配。

### 6.6 持久化 / 短期记忆

复用既有决策（见 `.agents/notes/2026-09-08-langgraph-sqlite-checkpointer.md`）：`SqliteSaver` 落 `<会话工作区>/memory/checkpoints.db`，`thread_id = conversationId`。coder-agent 与 chat-agent 用**同一套** checkpointer 约定，agent 层只收 `BaseCheckpointSaver`，不感知路径。

---

## 7. 安全模型

沿用 deepagents「Trust the LLM，边界在工具/沙箱层」的立场（README 安全声明），本仓库补三道墙：

1. **路径墙**：文件后端根锁死会话工作区目录，无法读写系统其它位置。
2. **命令墙**：不开放裸 shell；只暴露白名单化的 `run_*` 工具，危险命令直接拒绝。
3. **审批墙**：`permissionMode==='approve'` 时，写文件 / 跑命令需宿主审批（映射 `FilesystemPermission` / `PermissionMode`，审批 UI 在 app 侧）。默认桌面单机场景可用 `auto`，赛事/共享环境切 `approve`。

`signal`（AbortSignal）全链路透传，用户可随时中断。

---

## 8. 分阶段实施计划

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| **P0 打通最小闭环** | `agent.ts` 用 `createDeepAgent` 替换占位；接 `@chatvein/filesystem`；接口对齐 chatAgent；更新 spec（占位「未实现」断言改成真实调用） | 「读一个文件→改一处→给出结果」端到端跑通 |
| **P1 验证闭环** | `verify.ts`：`run_build/run_tests/run_lint` + prompt 纪律；`LocalShellBackend` 根锁工作区 | 「改代码→跑测试失败→自修复→再跑通过」 |
| **P2 调度接线** | `router.plan` → `tier/maxSteps/tools/subagents` 映射；`toolsFilter` 只筛业务工具；checkpointer + threadId | 从 chat 无缝切 coder；跨轮续聊 |
| **P3 上下文与子代理** | `createSummarizationMiddleware` + `task` 子代理（complex band 开启） | 长会话不爆窗；大搜索走子代理 |
| **P4 安全与审批** | `permissionMode` + 命令白名单 + app 侧审批 UI 协议 | approve 模式下写/跑命令需确认 |

每阶段完成后按 `decision-notes` skill 写一篇中文决策笔记到 `.agents/notes/`。

---

## 9. 备选方案与否决理由（决策记录）

| 方案 | 否决理由 |
| --- | --- |
| **自研 LangGraph 编码循环**（在现有 StateGraph 骨架上手写 plan/edit/verify 节点与条件边） | 直接违反红线「能力包已有 API 时只调用，不另写循环」。deepagents 已提供 planning/fs/subagent/compaction 全套且是 LangChain 官方维护；自研等于重造成熟轮子，且要自己维护上下文管理、子代理隔离等硬骨头。**否决**。 |
| **改造 chat-agent（createAgent）加文件工具充当 coder** | `createAgent` 是通用 ReAct，缺 planning / 子代理 / 文件后端 / 压缩的开箱整合；硬加会把 coder 专属复杂度塞进 chat 路径。deepagents 正是「coding harness」定位，职责更清晰。**否决**。 |
| **接第三方 CLI（Aider / Claude Code / Codex）做子进程** | 引入外部二进制与各自鉴权/沙箱，跨平台（Windows 主）与许可复杂；且脱离本仓库 LangGraph/Cordis/记忆体系，无法复用 router/toolsFilter/checkpointer。**否决**（可作为将来「外部执行后端」扩展点，非核心）。 |
| **给模型开放裸 shell** | 安全面过大（Windows 上 `rm`/下载/越权）。改用白名单 `run_*` 工具 + 路径根锁 + 审批模式。**采用受限方案**。 |
| **coder 用独立 checkpointer / 记忆库** | 与 chat-agent 记忆决策分裂。复用同一 `SqliteSaver`（`checkpoints.db`）+ `thread_id=conversationId`。**采用复用**。 |

---

## 10. 待确认 / 开放问题

1. `deepagents` 中间件与 `createDeepAgent` 的确切参数签名，落地时以 `dist/index.d.ts`（`CreateDeepAgentParams` 等）为准逐一对齐。
2. `run_*` 验证工具的默认命令：从 `package.json scripts` 探测（`build`/`test`/`lint`），还是让 router/宿主注入？倾向前者（约定优于配置）+ 可覆盖。
3. 权限审批的 IPC 协议（app 侧）与 `PermissionMode` 的映射细节，需与主进程侧一并定义。
4. `changedFiles` 的提取方式：从 `StateBackend` 状态 diff，还是 `git status` 工作区 diff？
