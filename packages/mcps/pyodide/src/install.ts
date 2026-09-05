/**
 * 信任校验后经 Pyodide loadPackage / micropip 安装包。
 */
import {
  checkPackagesTrust,
  DEFAULT_TRUST_POLICY,
  type PackageTrustResult,
  type TrustPolicy,
} from './trust'
import { getPyodide } from './run'

export interface EnsureTrustedPackagesOptions {
  packages: string[]
  policy?: TrustPolicy
  timeoutMs?: number
}

export interface EnsureTrustedPackagesResult {
  ok: boolean
  installed: string[]
  via: Array<{ name: string; method: 'loadPackage' | 'micropip' }>
  rejected: PackageTrustResult[]
  error?: string
}

export async function ensureTrustedPackages(
  options: EnsureTrustedPackagesOptions,
): Promise<EnsureTrustedPackagesResult> {
  const specs = options.packages.map((p) => p.trim()).filter(Boolean)
  if (specs.length === 0) {
    return {
      ok: false,
      installed: [],
      via: [],
      rejected: [],
      error: 'packages 不能为空',
    }
  }
  if (specs.length > 20) {
    return {
      ok: false,
      installed: [],
      via: [],
      rejected: [],
      error: '单次最多安装 20 个包',
    }
  }

  const policy = options.policy ?? DEFAULT_TRUST_POLICY
  const checks = await checkPackagesTrust(specs, policy)
  const rejected = checks.filter((c) => !c.trusted)
  const trustedNames = checks.filter((c) => c.trusted).map((c) => c.name)

  if (trustedNames.length === 0) {
    return {
      ok: false,
      installed: [],
      via: [],
      rejected,
      error: '全部包未通过信任校验',
    }
  }

  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 180_000, 10_000), 600_000)
  const via: Array<{ name: string; method: 'loadPackage' | 'micropip' }> = []
  const installed: string[] = []

  try {
    const py = await getPyodide()
    await Promise.race([
      (async () => {
        for (const name of trustedNames) {
          // 先试 Pyodide 预编译包
          try {
            await py.loadPackage(name)
            via.push({ name, method: 'loadPackage' })
            installed.push(name)
            continue
          } catch {
            // fall through to micropip
          }
          await py.loadPackage('micropip')
          await py.runPythonAsync(`
import micropip
await micropip.install(${JSON.stringify(name)})
`)
          via.push({ name, method: 'micropip' })
          installed.push(name)
        }
      })(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`安装超时（${timeoutMs}ms）`)), timeoutMs)
      }),
    ])
  } catch (err) {
    return {
      ok: false,
      installed,
      via,
      rejected,
      error: err instanceof Error ? err.message : String(err),
    }
  }

  const ok = rejected.length === 0 && installed.length === trustedNames.length
  return {
    ok,
    installed,
    via,
    rejected,
    error: rejected.length
      ? '部分包被拒绝，已安装通过校验的包'
      : undefined,
  }
}
