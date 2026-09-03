/**
 * @chatvein/core
 *
 * The Harness facade — the only package callers (the Electron app and the
 * @chatvein/service CLI/sidecar) import directly.
 *
 * Plugin runtime: @deepseek-ai/cordis (Context / Service / Fiber).
 * Capability packages (models, tools, sandbox, …) are mounted as Cordis plugins
 * and exposed as services on the root Context. LangGraph remains the task-graph
 * orchestrator inside the orchestrator plugin — Cordis does not replace it.
 *
 * Boundary: Cordis lives only in pure Node (sidecar/in-process harness). The
 * Electron shell stays on @electrum/* and must not import cordis.
 */

export const CHATVEIN_CORE_VERSION = '0.1.0'

/** Re-export Cordis primitives so callers can type plugins against one entry. */
export { Context, Service, Fiber } from '@deepseek-ai/cordis'

export {}
