/**
 * 统一遥测核心（isomorphic-friendly，node 侧使用）。
 *
 * 设计要点：
 * - 事件名带命名空间：LLM 原始 IO 用 `llm:*`，业务编排/度量用 `trace:*`。
 * - 业务字段一律挂 `payload`；信封字段对齐主流可观测方案（OpenTelemetry / OpenInference）：
 *   `id / ts / name / traceId / spanId / parentSpanId / status / durationMs / attrs / payload`。
 * - 数据「落在哪」由业务决定：业务通过 {@link setTelemetrySink} 注入一个回调
 *   （现阶段 app 注入「IPC 推渲染进程 console.log」，未来可换 JSONL / PGlite）。
 * - 未注入 sink 时：开关打开则回落当前进程 `console.log`（脚本 / 单测）。
 *
 * 不依赖 node:fs，可被 models / agents 等任意包安全引用。
 */
import { randomUUID } from 'node:crypto'

/** 遥测事件状态，对齐 OTel span status */
export type TelemetryStatus = 'ok' | 'error'

/**
 * 统一遥测事件信封。
 * - `name`：`llm:request` / `trace:tool_select` 等命名空间事件名。
 * - `payload`：业务字段（工具选用度量、LLM 报文等），结构由各领域自定义。
 * - `attrs`：跨事件的通用维度（conversationId、modelId、selector…），可被 sink 上下文注入。
 */
export interface TelemetryEvent {
  /** 事件唯一 id */
  id: string
  /** 事件名，形如 `llm:request` / `trace:tool_select` */
  name: string
  /** 毫秒时间戳 */
  ts: number
  /** 一次请求/运行的关联 id（对齐 traceId） */
  traceId?: string
  /** 本事件所属 span id */
  spanId?: string
  /** 父 span id（对齐 parentSpanId） */
  parentSpanId?: string
  status?: TelemetryStatus
  /** 耗时（毫秒），对齐 duration */
  durationMs?: number
  /** 通用维度标签（对齐 OTel attributes） */
  attrs?: Record<string, unknown>
  /** 业务字段：领域自定义结构 */
  payload?: Record<string, unknown>
  /** 错误信息（status=error 时） */
  error?: string
}

/** 业务注入的落地回调：收到事件后写哪、怎么展示，全由业务决定 */
export type TelemetrySink = (event: TelemetryEvent) => void

export interface TelemetryEmitOptions {
  traceId?: string
  /** 本事件所属 span id；生产者可用外部 runId（如 LangChain runId）作为 span 标识 */
  spanId?: string
  parentSpanId?: string
  status?: TelemetryStatus
  durationMs?: number
  attrs?: Record<string, unknown>
  error?: string
}

/**
 * 请求级上下文：sink 转发时自动补到每个事件上（traceId + 通用 attrs）。
 * 由业务在一次请求开始时设置、finally 清除；避免把 traceId 逐层透传。
 */
export interface TelemetryContext {
  traceId?: string
  parentSpanId?: string
  attrs?: Record<string, unknown>
}

export class Telemetry {
  private sink: TelemetrySink | undefined
  private context: TelemetryContext | undefined

  /** 注入落地回调；返回清理函数。传 undefined 可注销。 */
  setSink(sink: TelemetrySink | undefined): () => void {
    this.sink = sink
    return () => {
      if (this.sink === sink) this.sink = undefined
    }
  }

  /** 设置请求级上下文（traceId/attrs）；返回清理函数。 */
  setContext(context: TelemetryContext | undefined): () => void {
    this.context = context
    return () => {
      if (this.context === context) this.context = undefined
    }
  }

  /** 发一条事件。业务字段放 payload；信封字段由 options/上下文补齐。 */
  emit(
    name: string,
    payload?: Record<string, unknown>,
    options: TelemetryEmitOptions = {},
  ): TelemetryEvent {
    const ctx = this.context
    const event: TelemetryEvent = {
      id: randomUUID(),
      name,
      ts: Date.now(),
      ...(ctx?.traceId || options.traceId
        ? { traceId: options.traceId ?? ctx?.traceId }
        : {}),
      ...(options.spanId ? { spanId: options.spanId } : {}),
      ...(options.parentSpanId || ctx?.parentSpanId
        ? { parentSpanId: options.parentSpanId ?? ctx?.parentSpanId }
        : {}),
      ...(options.status ? { status: options.status } : {}),
      ...(typeof options.durationMs === 'number' ? { durationMs: options.durationMs } : {}),
      ...(mergeAttrs(ctx?.attrs, options.attrs) ? { attrs: mergeAttrs(ctx?.attrs, options.attrs) } : {}),
      ...(payload && Object.keys(payload).length ? { payload } : {}),
      ...(options.error ? { error: options.error, status: options.status ?? 'error' } : {}),
    }
    this.dispatch(event)
    return event
  }

  /** 计时包裹：结束时发一条带耗时与 ok/error 的事件（对齐 OTel span）。 */
  async span<T>(
    name: string,
    fn: (span: { spanId: string }) => Promise<T>,
    options: Omit<TelemetryEmitOptions, 'durationMs' | 'status'> & {
      payload?: Record<string, unknown>
    } = {},
  ): Promise<T> {
    const spanId = randomUUID()
    const start = Date.now()
    try {
      const result = await fn({ spanId })
      this.emit(name, options.payload, {
        ...options,
        parentSpanId: options.parentSpanId ?? spanId,
        status: 'ok',
        durationMs: Date.now() - start,
      })
      return result
    } catch (err) {
      this.emit(name, options.payload, {
        ...options,
        parentSpanId: spanId,
        status: 'error',
        durationMs: Date.now() - start,
        error: (err as Error)?.message ?? String(err),
      })
      throw err
    }
  }

  private dispatch(event: TelemetryEvent): void {
    const sink = this.sink
    if (sink) {
      try {
        sink(event)
      } catch {
        // sink 异常不得影响业务
      }
      return
    }
    // 无 sink：开关打开时回落 console（脚本/单测）
    if (isTelemetryEnabled()) {
      // eslint-disable-next-line no-console
      console.log(`[chatvein:${event.name}]`, event.payload ?? event)
    }
  }
}

function mergeAttrs(
  a?: Record<string, unknown>,
  b?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!a && !b) return undefined
  return { ...(a ?? {}), ...(b ?? {}) }
}

/** 进程级单例：models / agents / app 共用同一通道 */
export const telemetry = new Telemetry()

/** 注入全局落地回调；返回清理函数 */
export function setTelemetrySink(sink: TelemetrySink | undefined): () => void {
  return telemetry.setSink(sink)
}

/** 设置请求级上下文（traceId + attrs）；返回清理函数 */
export function setTelemetryContext(context: TelemetryContext | undefined): () => void {
  return telemetry.setContext(context)
}

/** 发一条遥测事件 */
export function emitTelemetry(
  name: string,
  payload?: Record<string, unknown>,
  options?: TelemetryEmitOptions,
): TelemetryEvent {
  return telemetry.emit(name, payload, options)
}

/**
 * 遥测开关。
 * - 默认：NODE_ENV 含 development/dev，或存在 ELECTRON_RENDERER_URL
 * - 强制开：CHATVEIN_TELEMETRY=1（兼容旧名 CHATVEIN_LLM_DEBUG=1）
 * - 强制关：CHATVEIN_TELEMETRY=0（兼容旧名 CHATVEIN_LLM_DEBUG=0）
 */
export function isTelemetryEnabled(): boolean {
  // 显式设置的旧变量 CHATVEIN_LLM_DEBUG 优先（保持其「强制开/关」语义）；
  // 否则看新变量 CHATVEIN_TELEMETRY。
  const legacy = process.env.CHATVEIN_LLM_DEBUG?.trim()
  const flag = (legacy !== undefined && legacy !== ''
    ? legacy
    : process.env.CHATVEIN_TELEMETRY ?? ''
  ).trim()
  if (flag === '0' || flag === 'false') return false
  if (flag === '1' || flag === 'true') return true
  const nodeEnv = process.env.NODE_ENV ?? ''
  if (nodeEnv === 'development' || nodeEnv.includes('dev')) return true
  return Boolean(process.env.ELECTRON_RENDERER_URL)
}

/** 安全 JSON 序列化：处理循环引用 / bigint，超长截断 */
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
