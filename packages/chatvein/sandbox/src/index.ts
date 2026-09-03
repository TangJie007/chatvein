/**
 * @chatvein/sandbox
 *
 * Workspace isolation (per-run copied template directory) and restricted
 * child-process execution with timeout, locked cwd, env allowlist and an
 * environment snapshot. P0 = local subprocess; SandboxProvider interface leaves
 * room for a Docker/WSL2 backend (P1) aligned with the competition sandbox.
 */

export const CHATVEIN_SANDBOX_VERSION = '0.1.0'
export {}
