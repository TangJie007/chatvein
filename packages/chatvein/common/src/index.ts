/**
 * @chatvein/common
 *
 * Shared, dependency-light foundation for the Chatvein Agent Harness:
 * core domain types (Task / GraphState / TraceEvent / TokenStat / Budget /
 * TestReport / ForgeConfig), error hierarchy, and config schema.
 *
 * This package must stay free of `electron` and heavy framework imports so it
 * can run in pure Node (sidecar/CLI) and inside the Electron main process.
 */

export const CHATVEIN_COMMON_VERSION = '0.1.0'

// Core domain types are introduced incrementally (M0-6). Placeholder marker so
// the package builds standalone from day one.
export {}
