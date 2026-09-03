import { randomUUID } from 'node:crypto'
import type { TraceEvent, TraceEventKind } from '@chatvein/common'
import { EventBus } from './event-bus'
import { initRunDir, type RunDirLayout } from './run-dir'
import { JsonlTraceWriter } from './jsonl-writer'

export interface TraceSinkOptions {
  runsRoot: string
  runId: string
  /** 同时挂到外部总线（例如 UI 订阅） */
  bus?: EventBus
  inlineLimit?: number
}

/** EventBus + JSONL 落盘的薄封装 */
export class TraceSink {
  readonly bus: EventBus
  readonly layout: RunDirLayout
  private readonly writer: JsonlTraceWriter
  private readonly runId: string

  private constructor(layout: RunDirLayout, bus: EventBus, writer: JsonlTraceWriter, runId: string) {
    this.layout = layout
    this.bus = bus
    this.writer = writer
    this.runId = runId
  }

  static async create(options: TraceSinkOptions): Promise<TraceSink> {
    const layout = await initRunDir(options.runsRoot, options.runId)
    const bus = options.bus ?? new EventBus()
    const writer = new JsonlTraceWriter(layout, { inlineLimit: options.inlineLimit })
    return new TraceSink(layout, bus, writer, options.runId)
  }

  async emit(
    kind: TraceEventKind,
    partial: Omit<Partial<TraceEvent>, 'id' | 'runId' | 'ts' | 'kind'> & { name?: string } = {},
  ): Promise<TraceEvent> {
    const event: TraceEvent = {
      id: randomUUID(),
      runId: this.runId,
      ts: Date.now(),
      kind,
      ...partial,
    }
    const written = await this.writer.write(event)
    this.bus.emit(written)
    return written
  }
}

/**
 * @chatvein/observability
 * 一期最小：事件总线 + JSONL；PGlite 查询层后置。
 */
export const CHATVEIN_OBSERVABILITY_VERSION = '0.1.0'

export { EventBus, type TraceListener } from './event-bus'
export { initRunDir, type RunDirLayout } from './run-dir'
export { JsonlTraceWriter, type JsonlTraceWriterOptions } from './jsonl-writer'
