/**
 * 仅安装通过信任校验的包到工作区（npm install --ignore-scripts）。
 */
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import {
  checkPackagesTrust,
  DEFAULT_TRUST_POLICY,
  type PackageTrustResult,
  type TrustPolicy,
} from './trust'

export interface EnsureTrustedPackagesOptions {
  workspaceRoot: string
  packages: string[]
  policy?: TrustPolicy
  /** 默认 120s */
  timeoutMs?: number
}

export interface EnsureTrustedPackagesResult {
  ok: boolean
  installed: string[]
  rejected: PackageTrustResult[]
  stdout: string
  stderr: string
  error?: string
}

function spawnNpmInstall(
  cwd: string,
  packageNames: string[],
  timeoutMs: number,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    const args = [
      'install',
      ...packageNames,
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--save',
    ]
    const child = spawn('npm', args, {
      cwd,
      env: {
        ...process.env,
        npm_config_ignore_scripts: 'true',
      },
      windowsHide: true,
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
    }, timeoutMs)
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (c: string) => {
      stdout += c
    })
    child.stderr?.on('data', (c: string) => {
      stderr += c
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolvePromise({ code, stdout, stderr })
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      resolvePromise({
        code: 1,
        stdout,
        stderr: `${stderr}\n${err.message}`.trim(),
      })
    })
  })
}

export async function ensureTrustedPackages(
  options: EnsureTrustedPackagesOptions,
): Promise<EnsureTrustedPackagesResult> {
  const root = resolve(options.workspaceRoot.trim())
  if (!root) {
    return {
      ok: false,
      installed: [],
      rejected: [],
      stdout: '',
      stderr: '',
      error: 'workspaceRoot 不能为空',
    }
  }
  const specs = options.packages.map((p) => p.trim()).filter(Boolean)
  if (specs.length === 0) {
    return {
      ok: false,
      installed: [],
      rejected: [],
      stdout: '',
      stderr: '',
      error: 'packages 不能为空',
    }
  }
  if (specs.length > 20) {
    return {
      ok: false,
      installed: [],
      rejected: [],
      stdout: '',
      stderr: '',
      error: '单次最多安装 20 个包',
    }
  }

  const policy = options.policy ?? DEFAULT_TRUST_POLICY
  const checks = await checkPackagesTrust(specs, policy)
  const rejected = checks.filter((c) => !c.trusted)
  /** 保留原始 spec（含 @version），便于 pin */
  const trustedSpecs = specs.filter((_, i) => checks[i]?.trusted)

  if (rejected.length > 0 && trustedSpecs.length === 0) {
    return {
      ok: false,
      installed: [],
      rejected,
      stdout: '',
      stderr: '',
      error: '全部包未通过信任校验',
    }
  }

  if (trustedSpecs.length === 0) {
    return {
      ok: false,
      installed: [],
      rejected,
      stdout: '',
      stderr: '',
      error: '没有可安装的可信包',
    }
  }

  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 120_000, 10_000), 300_000)
  const { code, stdout, stderr } = await spawnNpmInstall(root, trustedSpecs, timeoutMs)
  const ok = code === 0 && rejected.length === 0
  return {
    ok,
    installed: code === 0 ? trustedSpecs : [],
    rejected,
    stdout: stdout.slice(0, 8_000),
    stderr: stderr.slice(0, 8_000),
    error:
      code === 0
        ? rejected.length
          ? '部分包被拒绝，已安装通过校验的包'
          : undefined
        : `npm install 失败（exit ${code}）`,
  }
}
