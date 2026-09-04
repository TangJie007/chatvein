/**
 * 开发环境 LLM 全量日志。
 * - Electron：经 `runWithLlmDebugLog` 把条目交给主进程，再推渲染进程 `console.log`
 * - 无上下文时：回落到当前进程 `console.log`（脚本/单测）
 *
 * 开关：
 * - 默认：NODE_ENV 含 development/dev，或存在 ELECTRON_RENDERER_URL
 * - 强制开：CHATVEIN_LLM_DEBUG=1
 * - 强制关：CHATVEIN_LLM_DEBUG=0
 */
import { AsyncLocalStorage } from 'node:async_hooks'

export type LlmDebugContext = {
  onLog: (source: string, payload: unknown) => void
}

const llmDebugAls = new AsyncLocalStorage<LlmDebugContext>()

export function isLlmDebugLogEnabled(): boolean {
  const flag = process.env.CHATVEIN_LLM_DEBUG?.trim()
  if (flag === '0' || flag === 'false') return false
  if (flag === '1' || flag === 'true') return true
  const nodeEnv = process.env.NODE_ENV ?? ''
  if (nodeEnv === 'development' || nodeEnv.includes('dev')) return true
  return Boolean(process.env.ELECTRON_RENDERER_URL)
}

export function safeJsonStringify(value: unknown, maxChars = 200_000): string {
  const seen = new WeakSet<object>()
  try {
    const raw = JSON.stringify(
      value,
      (_key, v) => {
        if (typeof v === 'bigint') return v.toString()
        if (typeof v === 'object' && v !== null) {
          if (seen.has(v as object)) return '[Circular]'
          seen.add(v as object)
        }
        return v
      },
      2,
    )
    if (raw.length <= maxChars) return raw
    return `${raw.slice(0, maxChars)}\n…[truncated ${raw.length - maxChars} chars]`
  } catch (err) {
    return `"[unserializable: ${(err as Error).message}]"`
  }
}

/** 把 payload 收成可 IPC / JSON 克隆的纯数据 */
export function toIpcSafePayload(payload: unknown): unknown {
  try {
    return JSON.parse(safeJsonStringify(payload)) as unknown
  } catch {
    return { error: 'payload_not_serializable' }
  }
}

/** 在绑定了 onLog 的异步上下文中跑 LLM（Electron chat 用） */
export function runWithLlmDebugLog<T>(ctx: LlmDebugContext, fn: () => Promise<T>): Promise<T> {
  return llmDebugAls.run(ctx, fn)
}

/** 记录一次 LLM 返回；优先交给 ALS onLog，否则 console */
export function logLlmResponse(source: string, payload: unknown): void {
  if (!isLlmDebugLogEnabled()) return
  const ctx = llmDebugAls.getStore()
  if (ctx) {
    try {
      ctx.onLog(source, payload)
    } catch {
      // ignore sink errors
    }
    return
  }
  console.log(`[chatvein:llm:${source}]`, safeJsonStringify(payload))
}
