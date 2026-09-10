/**
 * L0 前置层：安全护栏 → 显式锁定 → 缓存。
 *
 * 零模型调用、纯确定性，目标 < 1ms。
 *
 * 执行顺序（顺序本身是设计的一部分）：
 *   ① 安全护栏 —— 永不短路、永不缓存（规则会更新）
 *   ② 显式锁定 —— 确定性结果，优先于缓存
 *   ③ 缓存     —— 只存 RouteCore，命中后贴回新鲜的安全结果
 *
 * 设计全文：`分层路由与预算决策.md` §4.1
 */
import type { SafetyResult, SafetyRule, Lane, Domain, Band } from '../types'
import { createHash } from 'node:crypto'
import { LRUCache } from 'lru-cache'
import { DEFAULT_SAFETY_RULES } from '../rules/l0'
import { DEFAULT_BAND } from '../constants'
import { hasAnaphora } from '../signals/anaphora'
import { normalizeText } from '../normalize'

export type { Lane, Domain, Band } from '../types'
export { DEFAULT_BAND } from '../constants'
export { normalizeText } from '../normalize'

/**
 * 可缓存的路由核心（语义判断部分）。
 *
 * 刻意**不含 budget 与 safety**：二者都是策略，会随配置变更；
 * 缓存它们会导致策略更新后旧缓存继续生效，命中缓存后由调用方实时派生。
 */
export interface RouteCore {
  lane: Lane
  domain: Domain
  band: Band
  confidence: number
  query: {
    rewritten: string
    searchQuery?: string
    slots?: Record<string, unknown>
    intents?: string[]
  }
  reason: string
}

export interface L0Input {
  text: string
  history?: Array<{ role: string; content: string }>
  attachments?: Array<{ name: string; mime?: string }>
  lockLane?: Lane
  lockDomain?: Domain
}

// ==================== 缓存 ====================

/** 缓存 key 用字符串哈希（Node `crypto`，跨环境一致） */
export function hashString(s: string): string {
  return createHash('sha256').update(s).digest('base64url')
}

/**
 * 构造缓存 key。
 *
 * 只有检测到指代/续做信号时才纳入历史 —— 否则「北京天气」这类自足问题
 * 会因历史不同而 miss，命中率会被历史长度拖垮。
 */
export function buildCacheKey(
  text: string,
  input: Pick<L0Input, 'history' | 'attachments' | 'lockLane' | 'lockDomain'>,
  version = 'v1',
): string {
  const norm = normalizeText(text)
  const parts: string[] = [version, norm]

  if (hasAnaphora(norm)) {
    for (const t of (input.history ?? []).slice(-3)) {
      parts.push(`${t.role}:${normalizeText(t.content ?? '')}`)
    }
  }

  // 附件影响路由（有 xlsx 大概率是 office），必须进 key
  if (input.attachments?.length) {
    parts.push(input.attachments.map((a) => `${a.name}|${a.mime ?? ''}`).join(','))
  }
  if (input.lockLane) parts.push(`lane:${input.lockLane}`)
  if (input.lockDomain) parts.push(`domain:${input.lockDomain}`)

  return hashString(parts.join('\u0001'))
}

export interface RouteCacheOptions {
  /** 最大条目数，默认 1000 */
  max?: number
  /** 默认 TTL（毫秒），默认 5 分钟 */
  ttlMs?: number
}

/** 进程内 LRU + TTL 路由缓存（`lru-cache`）。 */
export function createRouteCache(
  options: RouteCacheOptions = {},
): LRUCache<string, RouteCore> {
  return new LRUCache({
    // 最多缓存 1000 条路由结果；超出时按 LRU 丢掉最久未用的
    max: options.max ?? 1000,
    // 每条默认存活 5 分钟（毫秒）；过期后 get 视为未命中
    ttl: options.ttlMs ?? 5 * 60 * 1000,
    updateAgeOnGet: true,
    ttlResolution: 0,
    // 与 Date 对齐，便于单测假时钟；生产精度足够
    perf: { now: () => Date.now() },
  })
}


/** 规则扫描。自定义规则（extra）优先于内置规则。 */
export function safetyScan(raw: string, extra: SafetyRule[] = []): SafetyResult {
  const text = normalizeText(raw)
  const rules = extra.length ? [...extra, ...DEFAULT_SAFETY_RULES] : DEFAULT_SAFETY_RULES
  let flagged: SafetyResult | undefined

  for (const r of rules) {
    if (!r.pattern.test(text)) continue
    if (r.action === 'reject') {
      return { verdict: 'reject', category: r.category, ruleId: r.id, reason: r.reason }
    }
    if (!flagged) {
      flagged = { verdict: 'review', category: r.category, ruleId: r.id, reason: r.reason }
    }
  }
  return flagged ?? { verdict: 'allow' }
}

/** 安全护栏对 lane 的下限约束：被 flag 的请求强制抬到 orchestrated（含审批） */
export function applySafetyFloor(core: RouteCore, safety: SafetyResult): RouteCore {
  if (safety.verdict !== 'review') return core
  if (core.lane === 'orchestrated') return core
  return {
    ...core,
    lane: 'orchestrated',
    band: 'complex',
    reason: `${core.reason}；安全护栏抬档：${safety.reason ?? safety.category}`,
  }
}

// ==================== ② 显式锁定 ====================

export interface LockSpec {
  lane: Lane
  domain?: Domain
  band?: Band
}

type Directive = LockSpec | 'auto'

/** 文内指令别名表 */
export const DIRECTIVES: Record<string, Directive> = {
  // 形态
  chat: { lane: 'direct', domain: 'general' },
  simple: { lane: 'direct', domain: 'general' },
  agent: { lane: 'agentic' },
  agentic: { lane: 'agentic' },
  plan: { lane: 'orchestrated' },
  complex: { lane: 'orchestrated' },
  // 领域（仅 general | code；原 office/doc 归通用）
  code: { lane: 'agentic', domain: 'code' },
  dev: { lane: 'agentic', domain: 'code' },
  office: { lane: 'agentic', domain: 'general' },
  doc: { lane: 'agentic', domain: 'general' },
  // 逃生舱：忽略一切外部锁定，重新路由
  auto: 'auto',
}

/**
 * 文内指令前缀：行首可选空白 + `/` `#` `@` 之一 + 指令名 + 后续空白。
 * 例：`/code 修类型`、`#auto 你好`、`@office 转表`
 * 只认拉丁指令名；未知指令不匹配吞字（见 extractDirective）。
 */
const DIRECTIVE_RE = /^\s*[/#@]([a-zA-Z_][\w-]*)\s*/

export interface ParsedDirective {
  /** 剥离指令后的正文 */
  text: string
  spec?: LockSpec
  forceAuto?: boolean
}

export function extractDirective(raw: string): ParsedDirective {
  const m = DIRECTIVE_RE.exec(raw)
  if (!m) return { text: raw }
  const spec = DIRECTIVES[m[1].toLowerCase()]
  // 未知指令不吞字，交回 L1/L2 正常理解
  if (!spec) return { text: raw }
  const text = raw.slice(m[0].length)
  return spec === 'auto' ? { text, forceAuto: true } : { text, spec }
}

/**
 * 解析锁定。优先级：`#auto`（清除一切）> 文内指令（覆盖）> 调用方 API 锁定（基底）。
 */
export function resolveLock(input: L0Input): { text: string; spec?: LockSpec } {
  const parsed = extractDirective(input.text)
  if (parsed.forceAuto) return { text: parsed.text }

  const base: LockSpec | undefined = input.lockLane
    ? { lane: input.lockLane, domain: input.lockDomain }
    : undefined

  if (!parsed.spec) return { text: parsed.text, spec: base }

  return {
    text: parsed.text,
    spec: {
      lane: parsed.spec.lane ?? base?.lane ?? 'direct',
      domain: parsed.spec.domain ?? base?.domain,
      band: parsed.spec.band ?? base?.band,
    },
  }
}

// ==================== L0 编排 ====================

export interface L0Context {
  cache?: LRUCache<string, RouteCore>
  /** 自定义安全规则（优先于内置） */
  safetyRules?: SafetyRule[]
  /** 路由逻辑版本：变更即让旧缓存失效 */
  version?: string
}

export interface L0Result {
  /** 有值 = L0 已定案，无需再走 L1–L3 */
  decision?: RouteCore
  decidedBy?: 'rule' | 'cache'
  /** 剥离指令后、供后续层使用的正文 */
  text: string
  safety: SafetyResult
  /** 供 L1–L3 产出后写回缓存 */
  cacheKey: string
}

export function runL0(input: L0Input, ctx: L0Context = {}): L0Result {
  // ① 安全护栏：永不短路、永不缓存
  const safety = safetyScan(input.text, ctx.safetyRules)

  // ② 解析显式锁定（同时剥离指令前缀）
  const { text, spec } = resolveLock(input)

  if (safety.verdict === 'reject') {
    return { text, safety, cacheKey: '' }
  }

  const finish = (core: RouteCore, decidedBy: 'rule' | 'cache'): L0Result => ({
    decision: applySafetyFloor(core, safety),
    decidedBy,
    text,
    safety,
    cacheKey: '',
  })

  // ③ 锁定优先于缓存：确定性结果，不必查缓存
  if (spec) {
    const band = spec.band ?? DEFAULT_BAND[spec.lane]
    return finish(
      {
        lane: spec.lane,
        domain: spec.domain ?? 'general',
        band,
        confidence: 1,
        query: { rewritten: text },
        reason: 'explicit lock',
      },
      'rule',
    )
  }

  // ④ 缓存查询（key 用剥离指令后的正文）
  const cacheKey = buildCacheKey(text, input, ctx.version)
  const cached = ctx.cache?.get(cacheKey)
  if (cached) return { ...finish(cached, 'cache'), cacheKey }

  return { text, safety, cacheKey }
}
