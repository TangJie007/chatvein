export { expandHome, isPathWithin, assertWithinWorkspace, resolveInWorkspace } from './paths'

export {
  runJsInVm2,
  runJsInNodeVm,
  prepareModuleSource,
  runWorkspaceScript,
  listWorkspaceScripts,
  runJsResultToText,
} from './run'
export type {
  RunJsOptions,
  RunJsResult,
  RunNodeVmOptions,
  RunWorkspaceScriptOptions,
} from './run'

export {
  TRUSTED_PACKAGE_ALLOWLIST,
  SAFE_NODE_BUILTINS,
  DEFAULT_TRUST_POLICY,
  normalizePackageName,
  checkPackageTrust,
  checkPackagesTrust,
  fetchWeeklyDownloads,
} from './trust'
export type { TrustPolicy, PackageTrustResult } from './trust'

export { ensureTrustedPackages } from './install'
export type {
  EnsureTrustedPackagesOptions,
  EnsureTrustedPackagesResult,
} from './install'

export { createVmsandboxMcpServer, startVmsandboxServer } from './server'
export type { CreateVmsandboxServerOptions } from './server'
