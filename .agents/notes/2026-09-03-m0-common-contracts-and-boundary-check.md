# 决策笔记：M0 落地——common 全量领域类型契约 + 架构红线脚本/CI

状态：已落地

## 背景

M0（基线与脚手架）要求 10 个能力包可 build/test、`@chatvein/common` 备齐核心类型、并由 CI 强制"`packages/chatvein/**` 不引 electron、app forge 不内嵌 LangChain"两条红线。盘点发现：11 个包的 tsup/vitest 骨架已在且 build/test 全绿；但 common 只有最小的 `TraceEvent/TokenStat/Budget/ChatModelLike`（刻意未塞满，见上一篇笔记），**缺 `Task/GraphState/TestReport/ForgeConfig/Logger`**；红线只写在文档里，**没有任何脚本强制**，root 也无 CI。

## 决策

- **common 按域拆文件补齐类型契约**（不再全堆 types.ts）：
  - `task.ts`：`Task`/`TaskTree`/`TaskStatus`/`TaskComplexity`，字段对齐 PRD 5.3.2（id/title/requirementRef/acceptance/dependsOn/parallelGroup/estimatedComplexity/status）+ `topoSortTasks()`（环/缺失依赖抛错）与 `nextRunnableTasks()`（依赖全 passed 才可调度）。
  - `graph.ts`：`GraphState`（对齐 PRD 5.3.3 / 02-方案设计 §4.1，camelCase）、`RunStatus`、`GraphNode`（plan…finalize）、`FileSummary`、`createInitialState()`（复用 `emptyTokenStat()/DEFAULT_BUDGET`）。
  - `verifier.ts`：`CheckResult`/`FailedCase`/`TestReport`/`VerifyResult`/`BuildStatus` + `isVerifyPassed()`（build 过且无失败用例才算过，落实"模型不得自述完成"）。
  - `config.ts`：`ForgeConfig`/`ModelEndpointConfig`/`TruncationConfig` + zod schema `forgeConfigSchema` 与 `parseForgeConfig()`（失败抛 `ValidationError`）；`DEFAULT_*` 常量；apiKey 可选、运行时注入。
  - `logger.ts`：harness 自带 `Logger` 接口（不依赖 @electrum）+ `createConsoleLogger()`（级别过滤/child 绑定）+ `createNullLogger()`（测试）。
  - `types.ts` 的 `TraceEventKind` 扩展为对齐 PRD 5.3.9 + M1 验收清单（run_start/run_end/node_enter/node_exit/model_call/model_fallback/tool_call/verify/budget/human/error/run_status/info）。
  - `index.ts` 统一 re-export。
- **命名统一 camelCase**：现有 types.ts 全是 camelCase（`promptTokens` 等），新增类型一致采用；PRD 表格里的 snake_case（`task_tree`/`run_id`）视为逻辑字段名，落盘 JSON 用 camelCase 同名字段。
- **红线脚本 `scripts/check-boundaries.mjs`**：纯 Node 零依赖，递归扫描——① `packages/chatvein/**` 的 import/require 不得出现 `electron` 或 `@electrum/*`；② `app/src/main/forge/**` 不得 import `@langchain/*`/`langchain`。命中即退出码 1。
- **root 脚本与 CI**：`package.json` 加 `check` 与 `verify:harness`（= check + build:harness + test:harness）；新增 `.github/workflows/ci.yml`（pnpm 11 + Node 22，跑 check → build:harness → test:harness）。

验收：common 5 个 spec 文件 22 个用例全绿；`pnpm verify:harness` 全绿；红线脚本经"临时放 electron import 探针"反向验证能抓到违规（探针已删）。

## 备选方案

**类型继续只放 types.ts 单文件**：M0 后类型量翻倍（Task/Graph/Config/Verifier/Logger），单文件会迅速膨胀且跨域耦合；按域拆分与包边界（compiler/orchestrator/verifier/config）对应，更易定位。

**GraphState 直接照抄 PRD 的 snake_case 字段**：会与包内既有 camelCase（TokenStat/Budget/TraceEvent）风格冲突，且 TS 惯例是 camelCase。选 camelCase 保持一致；PRD 字段名作为逻辑对照写在注释。

**用 eslint dependency-cruiser 做架构断言**：能力更强但要引入/eslint 一整套配置与依赖；M0 只需两条"不得 import X"的硬红线，一个零依赖 Node 脚本足够且 CI 跑得快。后续规则变复杂（层数/环检测）再升级 depcruise。

**Logger 直接复用 @electrum/common 的 Logger**：会让 common（最底层、被所有能力包依赖）反向依赖壳框架，违反"能力包零 @electrum"红线。故 harness 自带最小 Logger。

## 影响

- 收益：M1 的 models/tools/context/orchestrator/verifier 有了可直接 import 的共享类型与纯函数（topoSort/初始状态/配置校验/verify 判定），不必各自定义再对齐；红线从"文档约定"变为"脚本 + CI 强制"，防 R4（能力包误引 electron 导致纯 Node 跑不了）回归。
- 代价 / 放弃：类型是"契约先行"，多数尚未被跨包真实消费（M1 才接）；字段可能随实现微调，需按决策笔记维护规则同步事实。zod 已是 common 依赖，config schema 无新增依赖。
- 后续注意：`ForgeConfig.models` 默认空数组，需 app/CLI 注入端点与密钥；落盘 `tasks.json/run.json` 的读写方应使用这里的类型；M1 起新包引用这些类型后，若字段需要调整，在同一改动里更新本契约与 spec。
