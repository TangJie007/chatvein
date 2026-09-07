# Forge 后续任务拆解（M1 收口 → M2 成型）

> 版本：v1.0 ｜ 日期：2026-09-07
> 配套：[`03-开发计划书.md`](./03-开发计划书.md) §M1/§M2、[`02-方案设计.md`](./02-方案设计.md)
> 范围：本文只覆盖四个方向 —— **A 真实端到端实跑（M1 收口）**、**B core 干预门面（M2-6）**、**C compiler 模型抽取（M2-1）**、**D app Forge 控制台（M1-10 / M2-8）**。
> 约定：所有改动遵守架构红线 —— `packages/chatvein/**` 不 import electron；`app forge` 模块不直接 import langchain，只 import `@chatvein/core`。

---

## 0 背景与现状

M1 骨架代码已全部落地、`pnpm build:harness` + 单测全绿：

| 包 | 状态 | 关键入口 |
|----|------|---------|
| `common` | ✅ | `GraphState`/`Task`/`VerifyResult`/`ForgeConfig`(zod)/`TraceEvent` |
| `models` | ✅ | `ModelRouter`（强中弱+降级链+计量）、`createLangChainChatModel`、`createEndpointModel` |
| `observability` | ✅ | `TraceSink` / `EventBus`（JSONL 落盘 + run 目录） |
| `sandbox` | ✅ | `LocalSandboxProvider`（工作区隔离 + 受限子进程 + 快照） |
| `verifier` | ✅ | build/test 执行 → `VerifyResult`/`TestReport` |
| `compiler` | 🟡 | **仅确定性编译**（`single`/`sections`），无模型抽取 → 见 C |
| `orchestrator` | ✅ | `buildOrchestratorGraph` / `runForge`（StateGraph + checkpointer + 护栏） |
| `core` | 🟡 | `createHarness`/`Harness.start/resume/preview/loadRun`，**缺 pause/abort/intervene** → 见 B |
| `service` | 🟡 | CLI `run/preview/resume` 已通；`regression` 占位；**无 sidecar**（M2-7，本文不含） |
| `app` | ❌ | **无 Forge 模块**（现有 chat/vector/settings）→ 见 D |

> ⚠️ **关键缺口**：`runs/` 目录目前不存在 —— 骨架只被 mock 单测和不耗模型的 `preview` 验证过，**从未接真实模型端到端跑通**。M1 出口标准（"小需求端到端跑通、trace 可见、产物齐全"）尚未真正达成。这就是 A 存在的原因，也是四件事中**优先级最高**的一件。

### 推进顺序与依赖

```
A（端到端实跑，验证现状）
   │  暴露真实问题：prompt/工具协议/事件/续跑
   ▼
B（core pause/abort/intervene + report.md）  ──┐
   │  干预门面是 GUI/sidecar 的前置            ├─► D（app 控制台：in-process 最小版先做）
C（compiler 模型抽取，独立可并行）          ──┘
```

- **A 最先做**：它不写新功能，而是验证已写的功能，会暴露 B/C/D 的真实需求，避免在没跑过的地基上加东西。
- **B 与 C 可并行**：B 动 `core`/`orchestrator` 的生命周期；C 动 `compiler`，两者文件不重叠。
- **D 依赖 B**：GUI 的"暂停/终止/注入提示"按钮需要 B 的门面；但 D 的**最小版（开始 + 事件流 + Token 计数）只依赖现有 `start/onEvent/done`，可与 B 并行起步**。

---

## A. 真实端到端实跑（M1 收口，最高优先级）

### A.1 目标

用**真实模型网关**把 `forge run` 整条链路跑通，产出 `runs/<id>/` 全套产物，并验证三个核心能力：

1. **正向闭环**：需求 → 编译任务树 → implement 写码 → verify 通过 → finalize。
2. **修复闭环**：verify 失败 → diagnose 归因 → fix 改码 → 再 verify 通过。
3. **断点续跑**：中途杀进程 → `forge resume <runId>` 从 checkpoint 继续。

### A.2 前置：配置模型网关

CLI 通过 `loadForgeConfig()`（`service/src/config-loader.ts`，支持 `.ts/.mjs/.js/.json`，用 jiti 加载 TS）读取配置。配置 schema 见 `common/src/forge/config.ts` 的 `forgeConfigSchema`。

在仓库根或 `config/` 下建 `forge.config.ts`（**不要把 apiKey 硬编码进文件提交**；用环境变量注入）：

```ts
// config/forge.config.ts
import { defineForgeConfig } from '@chatvein/common' // 若未导出 defineForgeConfig，直接 export default 对象即可

export default {
  models: {
    strong: [{
      id: 'strong-1',
      baseUrl: process.env.FORGE_BASE_URL!,       // OpenAI 兼容网关，如 https://api.deepseek.com/v1
      apiKey: process.env.FORGE_API_KEY!,
      model: process.env.FORGE_MODEL_STRONG ?? 'deepseek-chat',
      maxConcurrency: 1,
    }],
    medium: [{
      id: 'medium-1',
      baseUrl: process.env.FORGE_BASE_URL!,
      apiKey: process.env.FORGE_API_KEY!,
      model: process.env.FORGE_MODEL_MEDIUM ?? 'deepseek-chat',
    }],
    weak: [{
      id: 'weak-1',
      baseUrl: process.env.FORGE_BASE_URL!,
      apiKey: process.env.FORGE_API_KEY!,
      model: process.env.FORGE_MODEL_WEAK ?? 'deepseek-chat',
    }],
  },
  // budget / parallelism / runsRoot / sandbox / retry / tools 均可缺省，走 zod 默认值
}
```

> 密钥安全：`run.json` 落盘时经 `redactConfig()` 把 `apiKey` 脱敏为 `***`（见 `core/src/harness.ts`）。配置文件里的 apiKey 字段也应留空、纯靠环境变量。

### A.3 准备最小 fixture

新建一个不依赖网络、命令在白名单内（`npm/pnpm/node/npx/tsc/vitest/jest…`，见 `DEFAULT_EXEC_ALLOWLIST`）的小需求：

- `examples/add/requirement.md`：需求文档（"写一个 `add(a,b)` 加法函数 + vitest 单测，导出并通过测试"）。
- `examples/add/workspace/`：工作区模板，预置 `package.json`（含 `vitest` 依赖与 `test` 脚本）、`tsconfig.json`。由 `LocalSandboxProvider` 的 `templatePath` 拷入每个 run 的 workspace。

> 用模板预置依赖是为了避开 `pnpm install` 走网络的不确定性；M1 先保证"写码→跑测试"链路，依赖安装后续再纳入。

### A.4 执行与验收

```bash
# 0) 注入网关凭据
export FORGE_BASE_URL=...   # Windows PowerShell: $env:FORGE_BASE_URL="..."
export FORGE_API_KEY=...

# 1) 先 preview（不耗模型）确认任务树合理
pnpm forge preview examples/add/requirement.md --single

# 2) 正向闭环（单任务，跳过 build，只跑 test）
pnpm forge run examples/add/requirement.md \
  --config config/forge.config.ts \
  --single --skip-build \
  --test-cmd "npx vitest run" \
  --runs-root runs

# 3) 断点续跑：在 implement/verify 之间 Ctrl+C 杀掉，再
pnpm forge resume <runId> --config config/forge.config.ts --runs-root runs
```

**产物验收**（`runs/<runId>/` 下应齐全）：

| 文件 | 内容 | 来源 |
|------|------|------|
| `run.json` | runId、requirementPath、startedAt、**脱敏后** config、env 快照 | `harness.start` |
| `tasks.json` | 编译出的任务树 | `compileToFile` |
| `trace.jsonl` | 逐行 `TraceEvent`（run_start/node_enter/node_exit/model_call/tool_call/verify/run_end…） | `TraceSink` |
| `checkpoints.db` | LangGraph 文件 checkpoint（resume 依据） | `WorkspaceCheckpointer` |
| `report.json` | `{ runId, status, summary, failedTasks, runDir }` | `harness` 收尾 |
| `workspace/` | 隔离工作区，含模型写出的源码与测试 | `LocalSandboxProvider` |

**验收标准**：
- 正向：`report.json.status === 'done'`，`workspace/` 内有模型生成的 `add` 实现与测试，trace 中能看到 `verify` 事件 `passed:true`。
- 修复闭环：fixture 里预置一个**会失败的测试**（或在需求里要求一个模型初版易错的边界），trace 中应出现 `verify failed → diagnose → fix → verify passed` 的节点序列。
- 续跑：杀进程后 `resume` 能从最近 checkpoint 继续，不重复已完成节点（观察 trace 的 node_enter 序列）。

### A.5 常见排障点（实跑大概率会暴露）

| 现象 | 可能原因 | 处置方向 |
|------|---------|---------|
| `未配置模型档：strong` | config 没加载到 / 环境变量为空 | 确认 `--config` 路径、jiti 加载、env 注入 |
| 工具调用参数校验失败 | LangChain `tool()` zod schema 与模型输出不匹配 | 调 `orchestrator/src/tools.ts` 的 schema/描述 |
| `exec_shell` 被白名单拒 | 测试命令不在 `DEFAULT_EXEC_ALLOWLIST` | 扩 `tools.execAllowlist` 或换白名单内命令 |
| verify 一直失败但模型自述完成 | 测试命令/解析器与 fixture 不匹配 | 校准 `verifier` 的命令与输出解析 |
| resume 重复跑节点 | checkpointer thread_id 不一致 | 确认 `forge-<runId>` 复用（`run.ts` 已固定） |
| token 超支熔断 | 预算默认值偏小 / 上下文未压缩 | 临时调大 `budget.maxTokens`；压缩是 M2-3 |

> A 的产出：一份**实跑记录**（runId、三项指标 token/时长/结果、遇到的问题与修复），作为 B/C/D 的输入。

---

## B. core 干预门面 + report.md（M2-6 / M2-5）

### B.1 目标

补齐 `RunHandle` 的运行时干预能力与人类可读报告：

- `pause()` / `resume()`：暂停/继续（节点边界生效，不强行打断子进程）。
- `abort()`：终止运行（`AbortController` 传播到模型调用与子进程）。
- `intervene(message)`：人工注入提示（在当前节点/下一轮进入模型上下文，且落 `human` trace 事件留痕）。
- `report.md`：结束时由 `report.json` + trace 聚合生成人类可读报告。

### B.2 现状

`core/src/harness.ts` 的 `RunHandle` 目前只有：

```ts
export interface RunHandle {
  runId: string
  onEvent(listener: (e: TraceEvent) => void): () => void
  done: Promise<RunReport>
}
```

`runForge`（`orchestrator/src/run.ts`）内部 `compiled.invoke(initialState, { configurable: { thread_id } })` 一次跑到结束，**没有暴露任何中断/注入信号**。`TraceEventKind` 已预留 `'human'` 和 `'run_status'`，`budget` 事件也在 —— 协议层不缺，缺的是把信号接进图。

### B.3 改动点

**1) `orchestrator/src/run.ts` —— 接收控制信号**

`RunForgeInput` 增加：

```ts
signal?: AbortSignal            // abort 传播
control?: {
  paused: Promise<void>         // 节点边界 await：暂停时挂起
  pendingHint: () => string | null  // 取人工注入（取走即清空）
}
```

- `compiled.invoke(...)` 传入 `signal`（LangGraph 支持 abort）。
- 在 `graph.ts` 各节点入口/出口 `await control?.paused`（用一个可反复 resolve 的"闸门" promise 实现 pause/resume）。
- implement/fix 节点组装 prompt 时，调 `control.pendingHint()` 取注入文本，追加进任务上下文；同时 `trace.emit('human', { name: 'intervene', payload: { message } })`。

**2) `core/src/harness.ts` —— 暴露门面**

```ts
export interface RunHandle {
  runId: string
  onEvent(listener: (e: TraceEvent) => void): () => void
  done: Promise<RunReport>
  pause(): void
  resume(): void
  abort(reason?: string): void
  intervene(message: string): void   // 落 human 事件 + 喂给图
}
```

- `Harness.start` 内建 `AbortController` + 暂停闸门 + hint 队列，构造 `control` 传给 `runForge`。
- abort 时：`controller.abort()` → 图停止 → sandbox 子进程树随 `AbortSignal` 杀掉 → `report.status = 'aborted'`。
- 暂停语义：只在**节点边界**生效（implement 内层 ReAct 跑到一个工具回合结束才挂起），不杀进程，resume 后继续。

**3) report.md 生成（M2-5，放 `observability` 或 `core`）**

新增 `renderReportMd(report, traceSummary): string`，输出：运行概览（status/时长/token/步数）、任务结果表、失败任务与最后一条 verify 错误、预算熔断记录（聚合 `budget` 事件）、产物路径。`harness` 收尾时与 `report.json` 同目录写 `report.md`。

### B.4 验收

- 单测（`@chatvein/testing` mock 模型/沙箱）：
  - `abort()` 后 `done` resolve 为 `status:'aborted'`，无子进程残留。
  - `pause()` 后图在节点边界停住，`resume()` 后继续，trace 时间戳体现挂起间隔。
  - `intervene('改用 function 声明')` 后，trace 有 `human` 事件，且后续 implement 的 prompt 含该文本。
- 真实：`report.md` 字段完整、可读。

### B.5 风险

- LangGraph 对 pause 的原生支持是"中断（interrupt）+ 人在环"，M2 可先用**节点边界闸门**的轻量实现；若后续要在工具回合中间暂停，再迁到 LangGraph `interrupt()`。
- abort 必须级联到内层 ReAct 的模型 fetch 与 sandbox 子进程，否则会泄漏进程。

---

## C. compiler 模型抽取（M2-1）

### C.1 目标

把需求文档从"确定性章节切分"升级为"**强模型抽取功能点 + 验收标准 + 依赖**，JSON Schema 校验，失败降级到确定性编译"，产出更贴合赛题的 `tasks.json`。

### C.2 现状

`compiler/src/compile.ts` 的 `compileRequirement({ markdown, strategy })`：
- `strategy: 'single' | 'sections'`，**纯同步、零模型**。
- `sections`：按 `##`/`###` 切，`###` 依赖所属 `##`，其余串行；复杂度按正文字数估算。
- 注释已预留：*"M2 会加 'model'：强模型按章节抽取功能点 + 验收标准。"*

`harness.preview` / `start` 的 `compileStrategy` 类型当前是 `'single' | 'sections'`，需要扩。

### C.3 改动点

**1) 新增 `compiler/src/extract.ts`（模型抽取）**

- 定义抽取结果的 zod schema（与 `Task` 对齐）：

  ```ts
  const extractedTaskSchema = z.object({
    title: z.string(),
    requirementRef: z.array(z.string()).default([]),
    acceptance: z.array(z.string()).min(1),
    dependsOn: z.array(z.string()).default([]),   // 用模型给的临时 id，后面重映射
    estimatedComplexity: z.enum(['low', 'mid', 'high']),
  })
  ```

- `extractTasksWithModel(markdown, textModel): Promise<Task[]>`：用强模型（走 `textModel('strong')` fetch 直连，省 LangChain 开销，与 diagnose 同路径）按章节/功能点抽取，要求返回 JSON；解析后过 schema。
- **降级链**：模型调用失败 / JSON 解析失败 / schema 校验失败 / 产出空任务 → catch 后回退到现 `compileRequirement({ strategy: 'sections' })`，并 `trace.emit('info'|'error', { name: 'compile_fallback' })` 留痕。
- id 重排 + 拓扑：模型给的依赖是临时标题/id，统一重映射为 `T01..`，再用现成 `topoSortTasks`（`common`）校验无环。

**2) `compile.ts` 扩策略**

- `CompileOptions.strategy` 增 `'model'`；新增异步入口 `compileRequirementAsync(options, deps)`（模型版必须 async），保留同步 `compileRequirement` 给 single/sections 和降级。
- `compileToFile` 支持 async 模型路径。

**3) 接线**

- `orchestrator` 的 plan 节点：`compileStrategy: 'model'` 时调 `compileRequirementAsync`，注入 `textModel` 与 `trace`。
- `core/harness`：`StartRunInput.compileStrategy` 类型扩 `'single' | 'sections' | 'model'`；`preview` 传模型时也走 async。
- `service/cli.ts`：`run`/`preview` 增 `--model-compile` 选项。

### C.4 验收

- 单测：mock 强模型返回合法 JSON → 任务树字段正确、依赖重映射无环；mock 返回非法 JSON / 抛错 → 自动降级 sections 且有 fallback trace。
- 真实：用一份**多功能点**赛题风格文档，`--model-compile` 产出的 `tasks.json` 任务粒度明显优于 sections（功能点被拆开、验收标准具体）。

### C.5 风险

- 模型输出 JSON 不稳定：强约束 prompt（"只输出 JSON 数组，不要解释"）+ schema 校验 + 降级兜底，三者缺一不可。
- 任务拆太细导致 implement 上下文碎片化：prompt 里给"单任务应是一个可独立验收的功能点"的粒度指引。

---

## D. app Forge 控制台（M1-10 最小版 → M2-8 完整版）

### D.1 目标

在 Electron 里能**启动一次 run、实时看事件流、看 Token/预算**。分两阶段，最小版不依赖 B/C。

> 架构红线：app 主进程 Forge 模块**只 import `@chatvein/core`**（`createHarness`），不 import langchain / 不直接碰 `@chatvein/orchestrator`。

### D.2 现状

- app 主进程模块在 `app/src/main/*`（`@electrum/common` 的 `@Module`/`@Injectable` 风格，参考 `vector/vector.service.ts`：`@Injectable()` class + 动态 `await import('@chatvein/vector')`）。
- `app.module.ts` 的 imports 当前是 `Window/File/User/Agent/Model/Settings/Chat/Vector` —— **无 ForgeModule**。
- 渲染端 views 有 `VectorDbView/SettingsView` 等，无 Forge 页。

### D.3 阶段一：最小控制台（M1-10，in-process，仅依赖现有 start/onEvent/done）

**主进程 `app/src/main/forge/`：**

- `forge.service.ts`：`@Injectable()`，持有一个 `Harness` 实例（懒加载 `await import('@chatvein/core')`）。
  - `startRun(requirementPath, opts)`：`createHarness({ config })` → `harness.start(...)` → `handle.onEvent(e => 推给渲染端)`。
  - 配置来源：复用 app 现有模型配置（`model/`、`settings/`，含 `secret.crypto.ts` 加密存 Key）映射成 `ForgeConfig` 的 `models` 三档；**不新增明文 Key**。
  - runs 目录：`join(app.getPath('userData'), 'forge', 'runs')`（与 vector 的 `userData/forge/` 约定一致）。
- `forge.module.ts`：注册 service + controller。
- IPC（controller，沿用现有 `chat:*` / vector 的 IPC 模式）：
  - `forge:start` → 返回 `{ runId }`
  - `forge:event` → 主进程 push 流式 `TraceEvent`（对齐 `TraceEventKind`：run_start/node_enter/node_exit/model_call/tool_call/verify/budget/run_end/error）
  - `forge:list-runs` / `forge:load-run` → 读历史（包 `harness.loadRun`）

**渲染端 `app/src/renderer/`：**

- 新增 `ForgeView.vue`：
  - 顶部：需求路径选择 + "开始"按钮 + 模型/预算状态。
  - 中间：**事件时间线**（按 `TraceEvent.kind` 渲染图标/颜色，复用 chat 思考流的样式语言）—— ▶ node_enter、🔧 tool_call、🧪 verify、🤖 model_call、✗ error。
  - 侧栏/底部：**Token 计数与预算**（累计 `model_call` usage、步数、墙钟；`budget` 事件高亮熔断）。
- 路由/菜单入口（参考 `TitleBar.vue` / `menu.service.ts` 加 "Forge" 页签）。

**阶段一验收**：app 内点"开始"，能实时看到节点/工具/verify 事件滚动，结束看到 status 与 token 汇总；产物落在 `userData/forge/runs/<id>/`。

### D.4 阶段二：完整控制台（M2-8，依赖 B + sidecar）

等 B（干预门面）与 M2-7（sidecar）完成后补：

- **任务树面板**：读 `tasks.json`，展示任务状态/依赖/复杂度，随事件高亮当前任务。
- **诊断面板**：verify 失败用例、diagnose 归因、预算/错误分布。
- **控制按钮**：暂停 / 终止 / 注入提示（调 B 的 `pause/abort/intervene`）。
- **重启续跑提示**：run 中断后提示 `resume`（调 `harness.resume`）。
- **切 sidecar 模式**（M2-7）：in-process 仅适合单 run；sidecar 支持杀进程后 resume、多 run、与 GUI 生命周期解耦。M2-9 再用 `@electrum/codegen` 由 controller 生成 IpcApi 类型替换手写。

### D.5 验收（阶段一）

- app 内启动 run → 事件实时渲染 → 结束有报告；关闭窗口不留下僵尸子进程（abort/cleanup 接窗口生命周期）。
- 红线检查：`app/src/main/forge/**` 中 `import` 不含 `langchain`/`langgraph`；只依赖 `@chatvein/core`（+ electron / node 内置）。

---

## 1 工作量与排期建议

| 方向 | 对应 WBS | 预估 | 前置 | 建议批次 |
|------|---------|------|------|---------|
| **A 端到端实跑** | M1 出口 | 1–1.5 天 | 模型网关 Key | **第 1 批，立即做** |
| **B 干预门面 + report.md** | M2-6 / M2-5 | 1.5–2 天 | A 暴露的问题先修 | 第 2 批（与 C 并行） |
| **C compiler 模型抽取** | M2-1 | 1.5 天 | 无（可与 A 后并行） | 第 2 批（与 B 并行） |
| **D app 控制台（最小版）** | M1-10 | 1.5–2 天 | 现有 start/onEvent 即可 | 第 2/3 批；完整版 M2-8 待 B+sidecar |

> 不在本文范围（后续里程碑）：M2-3 历史压缩/FileIndex、M2-4 verifier 归因 prompt 增强、M2-7 sidecar、M2-9 codegen、M2-10 加密配置体系、M2-11 赛题联调、CP2 群聊记忆。

---

## 2 一页速查

- **先跑通再说**：A 是当前唯一阻塞"M1 真正 Done"的事，且不写新代码、只配网关 + 跑 + 修暴露的问题。
- **B 给"控制"**：pause/abort/intervene 是 GUI 和 sidecar 的地基；report.md 补齐可交付产物。
- **C 给"智能拆任务"**：模型抽取 + schema 校验 + 确定性降级，让 tasks.json 从"章节"变"功能点"。
- **D 给"可视化"**：最小版只用 `start/onEvent/done` 就能做；暂停/终止/任务树/诊断等完整版等 B 与 sidecar。
