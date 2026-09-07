# Forge 编排架构（M1 实现）

> 版本 v1.0 ｜ 2026-09-07
> 代码：`packages/chatvein/{sandbox,verifier,compiler,orchestrator,core,service}`
> 用途：学习这套 Agent Harness 如何从"一份需求文档"跑到"可运行代码 + 测试通过"。

## 1 总览

Forge 是一个自动写代码的 Agent。核心思想是 **Plan-Execute（规划-执行）+ ReAct 双层循环**，全部用 LangGraph 表达，但两层图的形态不同。


- **外层（任务级）= StateGraph**：固定阶段 plan→dispatch→implement→verify→diagnose→fix→integrate→finalize，决定"现在该干什么"（Plan-Execute）。
- **内层（编码级）= ReAct**：implement/fix 节点内，模型拿工具（读写文件、跑命令）反复"思考→行动→观察"，把当前任务做对。

关键原则：**模型不能自述"完成"**。是否通过只由 verify 节点跑真实 build/test 的结构化结果判定。


## 2 分层

调用链：`service/app → core(Harness 门面) → orchestrator(StateGraph) → {compiler, agents, verifier, sandbox, models, context, observability}`。

Chat UI「编程开发」档同样经 Harness：`chat.service` 在 `workMode=code` 时把用户消息写成需求、`workspacePath` 指向 `devProjectRoot`，再 `start`；日常办公仍走 `@chatvein/agents` ReAct。

所有能力包都是纯 Node（不 import electron），所以同一份代码既能被 Electron 主进程 in-process 调用，也能被独立 Node 进程（CLI/sidecar）调用。


## 3 外层状态机：StateGraph

代码：`orchestrator/src/graph.ts` 的 `buildOrchestratorGraph()`。

状态用 LangGraph `Annotation.Root` 定义（`ForgeState`），字段对应 common 的 `GraphState`：任务树、当前任务、构建状态、测试报告、根因、重试计数、token 用量、预算、步数、连续失败数。每个字段用 `reducer: (_o,n)=>n`（覆盖）并给默认值。


## 3.1 边与流转

- plan → dispatch（任务树非空）
- dispatch → implement（有 pending 任务）/ → integrate（全部完成）
- implement → verify
- verify → markPassed（通过）/ → diagnose（失败且未超连续失败上限）
- diagnose → fix
- fix → verify
- integrate → finalize（通过）/ → diagnose（失败且预算充足）
- markPassed → dispatch（继续下一个任务）
- markFailed → finalize（连续失败超上限 → 跳过并结束）


## 3.2 全局护栏（熔断）

`orchestrator/src/guards.ts` 的 `checkBudget` 在每个节点后检查四项阈值，任一触发返回 `{ kind, message }`：

- tokens：累计 token 超 `budget.maxTokens`
- steps：单任务步数超 `budget.maxSteps`（默认 30）
- wallclock：墙钟超 `budget.maxWallClockMs`（默认 6h）
- failures：连续失败超 `budget.maxConsecutiveFailures`（默认 3）

触发后状态机走 finalize 路径，标记 aborted 并写 `budget` trace 事件。护栏只判定，不消费模型。


## 4 内层循环：implement/fix 的 ReAct

`implement`/`fix` 节点调用 `runAgentNode`（`orchestrator/src/nodes.ts`）：

1. 取模型档：implement/fix 用强模型，diagnose 用中模型（经 `ModelRouter`）。
2. 组装 system prompt：角色说明 + 当前任务标题/验收标准 +（fix 时）错误关键帧 + 文件索引。
3. 绑定 Forge 编码工具（`createForgeTools`）。
4. `createReactChatAgent({ model, tools })` → `invokeReactChatAgent`：内层自动循环——模型决定调工具→观察→继续，直到无 tool_calls 或触发 BudgetGuard。

工具全部经 `SandboxProvider` 执行，天然受路径 jail / 命令白名单 / 超时约束。


## 5 沙箱：LocalSandboxProvider

代码：`sandbox/src/local.ts`。决策已锁定（design/07）：内嵌、零外部依赖、独立工作区 + 受限 `child_process`。

- `prepare(runId)`：建 `runs/<id>/workspace/`（可选从模板拷贝）。
- `exec({ argv, cwd, env, timeoutMs })`：在 workspace 内 `child_process` 执行：
  - cwd 锁定到 workspace 内（相对路径越界拒绝）；
  - env 仅注入白名单（不继承宿主 API Key 等敏感变量）；
  - 命令白名单（`node`/`npm`/`git`/`vitest`…）外拒绝；
  - 超时杀进程树，返回结构化 `ExecResult { code, stdout, stderr, truncated }`。
- `snapshot()`：记录 Node/OS 版本写入 `run.json`（可复现）。

关键方法 `resolveInside(p)`：把任意路径规整到 workspace 内绝对路径，越界抛错——所有工具读写的"路径 jail"。


## 6 验证闭环：verifier

代码：`verifier/src/index.ts`。硬规则：**通过证据只能来自结构化 verify 输出**。

- `build(sandbox, cmd)`：在沙箱跑构建命令，解析退出码 → `CheckResult`。
- `test(sandbox, cmd)`：跑测试命令，再用 `parseTestOutput` 把输出解析成 `TestReport { passed, failed, failures: FailedCase[] }`。
- `isVerifyPassed`：`buildStatus==='pass' 且 test.failed===0` 才通过。

`parseTestOutput` 目前按通用模式（失败行、`✓/✗`、断言差异）粗解析；M2 会按赛事测试框架（vitest/jest）精化，只回传失败用例名 + 断言 + 堆栈关键帧，避免把整份日志喂给模型。


## 7 需求编译：compiler

代码：`compiler/src/index.ts`。M1 用确定性策略（不消耗模型调用），模型抽取留 M2-1。

- `compileRequirement({ markdown, strategy })`：
  - `single`：整篇文档作为一个任务（快速打通闭环）；
  - `sections`（默认）：按 `##` 标题切分章节，每节一个任务，小节作为验收标准（acceptance）。
- `compileToFile({..., outPath })`：落盘 `tasks.json`（供预览/复盘）。
- 工具函数 `topoSortTasks` / `nextRunnableTasks`（在 common）支持拓扑调度与依赖判定。

产物是 `Task[]`，字段含 `id/title/requirementRef/acceptance/dependsOn/parallelGroup/estimatedComplexity/status`，与 PRD 5.3.2 对齐。


## 8 门面：core Harness

代码：`core/src/harness.ts`。app 与 service 唯一直接 import 的入口。

- `createHarness({ config })`：校验 forge.config（zod），返回 `Harness`。
- `start(input)`：准备沙箱 → 初始化 `TraceSink`（run 目录 + EventBus）→ 写 `run.json`（环境快照、脱敏配置）→ 落 `tasks.json` → 异步 `runForge` → 返回 `RunHandle { runId, onEvent, done }`。
- `resume(runId)`：同 runId 重新驱动图，checkpointer 按 thread `forge-<runId>` 续最近 checkpoint。
- `preview`：只跑 compiler，不消耗模型。
- `loadRun`：读历史 `tasks.json` / `report.json`。

`onEvent` 订阅的是 `TraceSink.bus`，所有节点/工具/模型事件实时回流给 CLI/GUI。


## 9 CLI：service `forge`

代码：`service/src/cli.ts` + `config-loader.ts`。只做参数解析 / 退出码，逻辑全在 core。

- `forge run <req.md> [--config forge.config.ts] [--single] [--skip-build] [--build-cmd ...] [--test-cmd ...]`
- `forge preview <req.md>`：只编译任务树打印，不跑模型。
- `forge resume <runId>`：从 checkpoint 续跑。
- `forge regression`：M2-7 实现（固定需求 + seed 出指标对比表）。

`config-loader` 用 `jiti` 加载 `.ts/.mjs/.js/.json` 配置；密钥从环境变量 `FORGE_API_KEY` / `FORGE_MODEL_KEY_<TIER>` 注入，不在配置文件里落盘。所有 trace 事件实时打印到终端（节点进出、工具调用、verify 结果、错误）。


## 10 怎么跑起来（学习入口）

```bash
# 1) 编译（一次）
pnpm build:harness

# 2) 预览任务树（不耗模型）
node packages/chatvein/service/dist/cli.js preview examples/add-requirement.md

# 3) 跑一次完整 run（需配置模型网关）
FORGE_BASE_URL=https://<网关>/v1 FORGE_API_KEY=sk-xxx FORGE_MODEL=claude-xxx \
  node packages/chatvein/service/dist/cli.js run examples/add-requirement.md

# 产物在 runs/<runId>/：trace.jsonl、tasks.json、run.json、report.json、workspace/
```

看 `orchestrator/src/graph.ts` 理解状态机，看 `orchestrator/src/nodes.ts` 理解每个节点函数，看 `service/src/cli.ts` 理解事件如何回流——这是三条最短学习路径。


## 11 关键设计决策与踩坑

1. **Forge 工具 ≠ Chat 的 MCP 工具**：`orchestrator/src/tools.ts` 的 `createForgeTools` 是另一套——它必须经 `SandboxProvider` 在隔离工作区执行、带路径 jail 与命令白名单。Chat 的 `@chatvein/tools` 是面向对话的 MCP 目录，二者物理隔离。
2. **不写手写 while 循环**：外层用 LangGraph `StateGraph` 声明节点/边，内层用官方 `createReactChatAgent`（langchain）。`@chatvein/*` 只做装配、prompt、工具、trace、护栏。复用了 Chat 轨已验证的 `createReactChatAgent`。
3. **checkpoint 复用**：`agents/src/checkpointer.ts` 的 `WorkspaceCheckpointer`（基于 `node:sqlite`）被 Forge 复用——外层 StateGraph 每节点后落盘，崩溃后 `resume` 按 thread 续状态。
4. **verify 是唯一真相源**：模型不能自述完成，必须 verify 跑真实 build/test 出结构化 `TestReport`。
5. **`node:sqlite` 打包坑**：tsup/esbuild 在 CJS 输出时会把 `import {DatabaseSync} from 'node:sqlite'` 静态打包成 `require('sqlite')`（丢失 `node:` 前缀），导致 MODULE_NOT_FOUND。最终用 `nodeRequire('node:sql'+'ite')` 动态加载绕过。所有能力包必须纯 Node、不引 electron（CI 红线）。
