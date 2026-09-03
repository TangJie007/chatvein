/**
 * @chatvein/tools
 *
 * Agent tool layer: read_file / write_file / apply_patch / list_dir /
 * glob_search / grep_search / exec_shell / git_op / start_service / smoke_check.
 * Every tool enforces timeout, output truncation (via @chatvein/context) and a
 * command allowlist, and emits trace events.
 */

export const CHATVEIN_TOOLS_VERSION = '0.1.0'
export {}
