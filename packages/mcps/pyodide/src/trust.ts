/**
 * 可信 PyPI / Pyodide 包策略：硬白名单 ∪ PyPI 周下载量门槛。
 * 拒绝 URL / VCS / 本地路径；安装走 loadPackage 或 micropip。
 */

/** 社区广泛使用，默认放行 */
export const TRUSTED_PACKAGE_ALLOWLIST = new Set([
  // 科学计算（多为 Pyodide 预编译包）
  'numpy',
  'pandas',
  'scipy',
  'matplotlib',
  'sympy',
  'scikit-learn',
  'sklearn',
  'statsmodels',
  'networkx',
  'pillow',
  'PIL',
  // 数据 / 解析
  'pyyaml',
  'yaml',
  'openpyxl',
  'xlrd',
  'beautifulsoup4',
  'bs4',
  'lxml',
  'html5lib',
  'regex',
  'python-dateutil',
  'dateutil',
  'pytz',
  'tzdata',
  'six',
  'attrs',
  'pydantic',
  'jsonschema',
  'msgpack',
  'orjson',
  // HTTP / 工具（micropip 纯 Python 轮子）
  'httpx',
  'urllib3',
  'certifi',
  'idna',
  'charset-normalizer',
  'requests',
  'tqdm',
  'click',
  'tabulate',
  'jinja2',
  'markupsafe',
  'packaging',
  'typing-extensions',
  'typing_extensions',
])

export interface TrustPolicy {
  /** PyPI last_week 下限；默认 1_000_000 */
  minWeeklyDownloads: number
  extraAllowlist?: string[]
  denylist?: string[]
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

/** 规范化包名：PEP 503 风格，去掉 ==version */
export function normalizePackageName(spec: string): string | null {
  const raw = spec.trim()
  if (!raw) return null
  if (/[:\\/]/.test(raw) || raw.includes('..') || raw.startsWith('.')) return null
  if (/^(git\+|git:|http:|https:|file:|ssh:)/i.test(raw)) return null

  // 去掉 extras / 版本：name[extra]==1.0 / name>=1
  let name = raw.split('[')[0]!.trim()
  name = name.split(/[<>=!~\s]/)[0]!.trim()
  if (!name) return null

  const ok = /^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/i.test(name) && name.length <= 214
  return ok ? name.toLowerCase().replace(/_/g, '-') : null
}

export async function fetchWeeklyDownloads(packageName: string): Promise<number | null> {
  const encoded = encodeURIComponent(packageName)
  const url = `https://pypistats.org/api/packages/${encoded}/recent?period=week`
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 12_000)
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { accept: 'application/json', 'user-agent': 'chatvein-mcp-pyodide/0.1' },
    })
    if (!res.ok) return null
    const body = (await res.json()) as {
      data?: { last_week?: number }
    }
    return typeof body.data?.last_week === 'number' ? body.data.last_week : null
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

  const deny = new Set((policy.denylist ?? []).map((s) => normalizePackageName(s) ?? s.toLowerCase()))
  if (deny.has(name)) {
    return { name, trusted: false, reason: '在拒绝名单中', source: 'denied' }
  }

  const allow = new Set([
    ...TRUSTED_PACKAGE_ALLOWLIST,
    ...(policy.extraAllowlist ?? [])
      .map((s) => normalizePackageName(s))
      .filter((s): s is string => Boolean(s)),
  ])
  // 白名单里可能有 underscore 别名
  const allowNorm = new Set([...allow].map((s) => s.replace(/_/g, '-')))
  if (allowNorm.has(name) || TRUSTED_PACKAGE_ALLOWLIST.has(name.replace(/-/g, '_'))) {
    return {
      name,
      trusted: true,
      reason: '硬白名单（广泛使用的可信包）',
      source: 'allowlist',
    }
  }
  // 也检查原始白名单（含 sklearn / PIL 等短名）
  if ([...TRUSTED_PACKAGE_ALLOWLIST].some((a) => a.toLowerCase().replace(/_/g, '-') === name)) {
    return {
      name,
      trusted: true,
      reason: '硬白名单（广泛使用的可信包）',
      source: 'allowlist',
    }
  }

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
      reason: '无法查询 PyPI 周下载量',
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
