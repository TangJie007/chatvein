/**
 * @chatvein/core
 *
 * Harness 门面：调用方（Electron 应用、`@chatvein/service` CLI/sidecar）应只直接依赖本包。
 *
 * 插件运行时：`@deepseek-ai/cordis`（Context / Service / Fiber）。
 * 能力包（models、tools、sandbox 等）以 Cordis 插件挂到根 Context 并暴露为服务。
 * 任务图编排仍由 orchestrator 内的 LangGraph 负责，Cordis 不替代它。
 *
 * 边界：Cordis 仅用于纯 Node（sidecar / 进程内 Harness）；Electron 壳走 `@electrum/*`，禁止 import cordis。
 */

export const CHATVEIN_CORE_VERSION = '0.1.0'

/** 再导出 Cordis 原语，便于调用方统一从本入口做插件类型标注 */
export { Context, Service, Fiber } from '@deepseek-ai/cordis'

/** Harness 门面：start / resume / preview / loadRun */
export {
  Harness,
  createHarness,
  type HarnessOptions,
  type StartRunInput,
  type RunPlan,
  type RunHandle,
  type RunReport,
} from './harness'
