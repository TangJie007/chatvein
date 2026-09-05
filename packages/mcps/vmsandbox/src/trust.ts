/**
 * 可信 npm 包策略：硬白名单 ∪ 周下载量门槛。
 * 拒绝 git/file/URL 规格；安装侧配合 --ignore-scripts。
 */

/** 社区广泛使用、默认放行（不全靠下载量 API） */
export const TRUSTED_PACKAGE_ALLOWLIST = new Set([
  // 工具 / 数据
  'lodash',
  'lodash-es',
  'es-toolkit',
  'ramda',
  'underscore',
  'zod',
  'yup',
  'joi',
  'ajv',
  'uuid',
  'nanoid',
  'ulid',
  'ms',
  'dayjs',
  'date-fns',
  'moment',
  'luxon',
  'semver',
  'minimatch',
  'glob',
  'fast-glob',
  'picomatch',
  'micromatch',
  // 字符串 / 路径类（纯逻辑）
  'chalk',
  'kleur',
  'ansi-colors',
  'slugify',
  'change-case',
  'pluralize',
  'validator',
  'sanitize-html',
  // 解析
  'csv-parse',
  'csv-stringify',
  'papaparse',
  'yaml',
  'js-yaml',
  'toml',
  'ini',
  'qs',
  'query-string',
  'cheerio',
  'marked',
  'markdown-it',
  'highlight.js',
  'prismjs',
  // 数学 / 随机
  'mathjs',
  'decimal.js',
  'bignumber.js',
  'seedrandom',
  // 测试/断言风格（脚本内可能用到）
  'deep-equal',
  'fast-deep-equal',
])

/** NodeVM 允许的 builtin（禁止 fs/net/child_process 等） */
export const SAFE_NODE_BUILTINS = [
  'assert',
  'buffer',
  'events',
  'path',
  'path/posix',
  'path/win32',
  'querystring',
  'string_decoder',
  'url',
  'util',
  'punycode',
] as const

export interface TrustPolicy {
  /** 周下载量下限（npm last-week）；默认 1_000_000 */
  minWeeklyDownloads: number
  /** 额外允许的包名 */
  extraAllowlist?: string[]
  /** 强制拒绝 */
  denylist?: string[]
  /** 跳过联网下载量检查（仅白名单）；测试用 */
  offlineAllowlistOnly?: boolean
}

export const DEFAULT_TRUST_POLICY: TrustPolicy = {
  minWeeklyDownloads: 1_000_000,
}

export interface PackageTrustResult {
  name: string
  trusted: boolean
  reason: string
  weeklyDownloads?: number
  source: 'allowlist' | 'downloads' | 'denied' | 'invalid'
}

/** 规范化包名：只允许 name 或 @scope/name，去掉版本/tag */
export function normalizePackageName(spec: string): string | null {
  const raw = spec.trim()
  if (!raw) return null
  // 拒绝协议与路径
  if (/[:\\]/.test(raw) || raw.includes('..') || raw.startsWith('.') || raw.startsWith('/')) {
    return null
  }
  if (/^(git\+|git:|http:|https:|file:|npm:)/i.test(raw)) return null

  // 去掉 @version / @tag（scoped 包第一个 @ 是 scope）
  let name = raw
  if (raw.startsWith('@')) {
    const slash = raw.indexOf('/')
    if (slash < 0) return null
    const rest = raw.slice(slash + 1)
    const at = rest.indexOf('@')
    name = at >= 0 ? raw.slice(0, slash + 1 + at) : raw
  } else {
    const at = raw.indexOf('@')
    name = at >= 0 ? raw.slice(0, at) : raw
  }

  const ok =
    /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i.test(name) &&
    name.length <= 214
  return ok ? name.toLowerCase() : null
}

export async function fetchWeeklyDownloads(packageName: string): Promise<number | null> {
  const encoded = packageName
    .split('/')
    .map((p) => encodeURIComponent(p))
    .join('/')
  const url = `https://api.npmjs.org/downloads/point/last-week/${encoded}`
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 12_000)
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { accept: 'application/json', 'user-agent': 'chatvein-mcp-vmsandbox/0.2' },
    })
    if (!res.ok) return null
    const body = (await res.json()) as { downloads?: number }
    return typeof body.downloads === 'number' ? body.downloads : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export async function checkPackageTrust(
  spec: string,
  policy: TrustPolicy = DEFAULT_TRUST_POLICY,
): Promise<PackageTrustResult> {
  const name = normalizePackageName(spec)
  if (!name) {
    return {
      name: spec,
      trusted: false,
      reason: '非法包名（禁止 git/file/URL/路径）',
      source: 'invalid',
    }
  }

  const deny = new Set((policy.denylist ?? []).map((s) => s.toLowerCase()))
  if (deny.has(name)) {
    return { name, trusted: false, reason: '在拒绝名单中', source: 'denied' }
  }

  const allow = new Set([
    ...TRUSTED_PACKAGE_ALLOWLIST,
    ...(policy.extraAllowlist ?? []).map((s) => s.toLowerCase()),
  ])
  if (allow.has(name)) {
    return {
      name,
      trusted: true,
      reason: '硬白名单（广泛使用的可信包）',
      source: 'allowlist',
    }
  }

  // @types/*：跟主包策略类似，要求高下载量
  if (policy.offlineAllowlistOnly) {
    return {
      name,
      trusted: false,
      reason: '不在白名单且离线模式禁止按下载量放行',
      source: 'denied',
    }
  }

  const weekly = await fetchWeeklyDownloads(name)
  if (weekly == null) {
    return {
      name,
      trusted: false,
      reason: '无法查询 npm 周下载量',
      source: 'denied',
    }
  }
  if (weekly < policy.minWeeklyDownloads) {
    return {
      name,
      trusted: false,
      reason: `周下载量 ${weekly.toLocaleString()} < 门槛 ${policy.minWeeklyDownloads.toLocaleString()}`,
      weeklyDownloads: weekly,
      source: 'downloads',
    }
  }
  return {
    name,
    trusted: true,
    reason: `周下载量 ${weekly.toLocaleString()} ≥ 门槛`,
    weeklyDownloads: weekly,
    source: 'downloads',
  }
}

export async function checkPackagesTrust(
  specs: string[],
  policy: TrustPolicy = DEFAULT_TRUST_POLICY,
): Promise<PackageTrustResult[]> {
  const out: PackageTrustResult[] = []
  for (const spec of specs) {
    out.push(await checkPackageTrust(spec, policy))
  }
  return out
}
