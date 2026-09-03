/**
 * @chatvein/sandbox
 *
 * LOCKED (2026-09-03): embedded sandbox = independent workspace + restricted
 * Node `child_process` (LocalSandboxProvider). Fully embedded, zero external
 * deps (no Docker required). See docs/design/07-沙箱方案.md.
 *
 * - Workspace: runs/<run_id>/workspace/ (template copy, path jail)
 * - Exec: cwd lock, env allowlist, command allowlist, timeout, output truncate
 * - P1: optional DockerSandboxProvider behind SandboxProviderKind = 'docker'
 */

export const CHATVEIN_SANDBOX_VERSION = '0.1.0'

/** Default provider kind — do not change without updating design/07. */
export const DEFAULT_SANDBOX_PROVIDER = 'local' as const

export type SandboxProviderKind = 'local' | 'docker'

export {}
