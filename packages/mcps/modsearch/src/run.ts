import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ModsearchEnvelope, ModsearchItem } from './types'

const requireFromHere = createRequire(
  typeof __filename !== 'undefined' ? __filename : fileURLToPath(import.meta.url),
)

/** 解析 `@liustack/modsearch` CLI（包内 dist/main.js） */
export function resolveModsearchCliEntry(): string {
  try {
    const pkgJson = requireFromHere.resolve('@liustack/modsearch/package.json')
    return join(dirname(pkgJson), 'dist', 'main.js')
  } catch {
    // "." 指向 dsh/index.js → 上溯到包根再进 dist
    const dshEntry = requireFromHere.resolve('@liustack/modsearch')
    return join(dirname(dshEntry), '..', 'dist', 'main.js')
  }
}

export interface RunModsearchOptions {
  query?: string
  url?: string
  source?: 'web' | 'x' | 'web,x'
  maxResults?: number
  timeoutMs?: number
  /** 关闭后失败直接抛错，不走 DuckDuckGo / HTTP */
  fallback?: boolean
}

function electronSafeEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  if (process.versions.electron) {
    env.ELECTRON_RUN_AS_NODE = '1'
  }
  return env
}

function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim()
  if (!trimmed) throw new Error('modsearch 无 stdout 输出')
  try {
    return JSON.parse(trimmed)
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1))
    }
    throw new Error(`无法解析 modsearch JSON：${trimmed.slice(0, 200)}`)
  }
}

function isUsefulEnvelope(env: ModsearchEnvelope): boolean {
  if (!Array.isArray(env.results) || env.results.length === 0) return false
  return env.results.some((r) => {
    if (r.status === 'unavailable') return false
    if ((r.items?.length ?? 0) > 0) return true
    if ((r.content?.trim()?.length ?? 0) > 0) return true
    if ((r.summary?.trim()?.length ?? 0) > 0) return true
    return false
  })
}

/** 跑 ModSearch CLI；超时 / 非 0 退出 / 无有效结果 → 抛错 */
export async function runModsearchCli(
  options: RunModsearchOptions,
): Promise<ModsearchEnvelope> {
  const query = options.query?.trim()
  const url = options.url?.trim()
  if (!query && !url) {
    throw new Error('runModsearchCli: 需要 query 或 url')
  }

  const args = [resolveModsearchCliEntry()]
  if (query) {
    args.push('-q', query)
  }
  if (url) {
    args.push('-u', url)
  }
  if (options.source) {
    args.push('-s', options.source)
  }
  const maxResults = options.maxResults ?? 8
  args.push('--max-results', String(maxResults))

  const timeoutMs = options.timeoutMs ?? 60_000

  const { stdout, stderr, code } = await spawnCapture({
    command: process.execPath,
    args,
    timeoutMs,
    env: electronSafeEnv(),
  })

  if (code !== 0) {
    throw new Error(
      `modsearch 退出码 ${code}${stderr.trim() ? `：${stderr.trim().slice(0, 400)}` : ''}`,
    )
  }

  const parsed = extractJsonObject(stdout) as ModsearchEnvelope
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('modsearch 返回非对象 JSON')
  }
  if (!Array.isArray(parsed.results)) {
    parsed.results = []
  }
  if (!isUsefulEnvelope(parsed)) {
    throw new Error('modsearch 无有效检索结果（results 空或 unavailable）')
  }
  return parsed
}

async function spawnCapture(params: {
  command: string
  args: string[]
  timeoutMs: number
  env: NodeJS.ProcessEnv
}): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(params.command, params.args, {
      env: params.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`modsearch 超时（>${params.timeoutMs}ms）`))
    }, params.timeoutMs)

    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (c: string) => {
      stdout += c
    })
    child.stderr?.on('data', (c: string) => {
      stderr += c
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ stdout, stderr, code })
    })
  })
}

/** DuckDuckGo 原始结果 → ModSearch 信封 */
export function mapDuckDuckGoResults(
  query: string,
  rawResults: Array<{ title?: string; url?: string; description?: string }>,
  maxResults = 8,
  reason?: string,
): ModsearchEnvelope {
  const items: ModsearchItem[] = rawResults.slice(0, maxResults).map((r) => ({
    title: String(r.title ?? ''),
    url: String(r.url ?? ''),
    snippet: r.description ? String(r.description) : undefined,
    source: 'duckduckgo',
  }))
  if (items.length === 0) {
    throw new Error('DuckDuckGo 无结果')
  }
  const summary = items
    .slice(0, 3)
    .map((i) => `- ${i.title}: ${i.url}`)
    .join('\n')
  return {
    mode: 'search',
    query,
    url: null,
    results: [
      {
        source: 'web',
        requestedSource: 'web',
        engine: 'duckduckgo',
        status: 'ok',
        summary: `DuckDuckGo 兜底结果（${items.length} 条）：\n${summary}`,
        items,
        uncertainty: ['结果来自 DuckDuckGo 兜底，未经过 ModSearch 引擎链。'],
        warnings: ['fallback:duckduckgo'],
        durationSeconds: null,
      },
    ],
    meta: { generatedAt: new Date().toISOString() },
    fallback: { used: true, engine: 'duckduckgo', reason },
  }
}

/** DuckDuckGo 搜索兜底（duck-duck-scrape） */
export async function searchDuckDuckGo(
  query: string,
  maxResults = 8,
  reason?: string,
): Promise<ModsearchEnvelope> {
  const { search, SafeSearchType } = await import('duck-duck-scrape')
  const raw = await search(query, { safeSearch: SafeSearchType.MODERATE })
  const results = Array.isArray(raw?.results) ? raw.results : []
  return mapDuckDuckGoResults(query, results, maxResults, reason)
}

/** 抓取失败时的轻量 HTTP 文本兜底（非 DDG） */
export async function fetchPageHttp(url: string): Promise<ModsearchEnvelope> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 20_000)
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { 'user-agent': 'chatvein-mcp-modsearch/0.1' },
      redirect: 'follow',
    })
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`)
    }
    const html = await res.text()
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 12_000)
    if (!text) throw new Error('页面无文本内容')
    return {
      mode: 'fetch',
      query: null,
      url,
      results: [
        {
          source: 'web',
          requestedSource: 'web',
          engine: 'http_fetch',
          status: 'ok',
          summary: `HTTP 兜底抓取（前 ${text.length} 字符）`,
          content: text,
          links: [],
          uncertainty: ['未使用 ModSearch；仅为去标签纯文本。'],
          warnings: ['fallback:http_fetch'],
          durationSeconds: null,
        },
      ],
      meta: { generatedAt: new Date().toISOString() },
      fallback: { used: true, engine: 'http_fetch' },
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 搜索：优先 ModSearch；失败则 DuckDuckGo。
 */
export async function webSearch(options: {
  query: string
  maxResults?: number
  timeoutMs?: number
  source?: 'web' | 'x' | 'web,x'
  fallback?: boolean
}): Promise<ModsearchEnvelope> {
  const query = options.query.trim()
  if (!query) throw new Error('query 不能为空')
  const useFallback = options.fallback !== false
  try {
    const env = await runModsearchCli({
      query,
      maxResults: options.maxResults,
      timeoutMs: options.timeoutMs,
      source: options.source ?? 'web',
    })
    return { ...env, fallback: { used: false, engine: null } }
  } catch (err) {
    if (!useFallback) throw err
    const reason = err instanceof Error ? err.message : String(err)
    const ddg = await searchDuckDuckGo(query, options.maxResults ?? 8, reason)
    return ddg
  }
}

/**
 * 读页：优先 ModSearch；失败则 HTTP 纯文本（DuckDuckGo 不做 URL 抓取）。
 */
export async function readPage(options: {
  url: string
  query?: string
  timeoutMs?: number
  fallback?: boolean
}): Promise<ModsearchEnvelope> {
  const url = options.url.trim()
  if (!url) throw new Error('url 不能为空')
  const useFallback = options.fallback !== false
  try {
    const env = await runModsearchCli({
      url,
      query: options.query?.trim() || undefined,
      timeoutMs: options.timeoutMs,
    })
    return { ...env, fallback: { used: false, engine: null } }
  } catch (err) {
    if (!useFallback) throw err
    const reason = err instanceof Error ? err.message : String(err)
    const page = await fetchPageHttp(url)
    return {
      ...page,
      fallback: { used: true, engine: 'http_fetch', reason },
    }
  }
}

export function envelopeToText(env: ModsearchEnvelope): string {
  return JSON.stringify(env, null, 2)
}
