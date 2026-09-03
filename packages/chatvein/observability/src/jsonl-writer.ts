import { appendFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { TraceEvent } from '@chatvein/common'
import type { RunDirLayout } from './run-dir'

/** 超过此字节数的 payload 改写独立文件，trace 只留 ref */
const DEFAULT_PAYLOAD_INLINE_LIMIT = 8 * 1024

export interface JsonlTraceWriterOptions {
  inlineLimit?: number
}

export class JsonlTraceWriter {
  private readonly inlineLimit: number

  constructor(
    private readonly layout: RunDirLayout,
    options: JsonlTraceWriterOptions = {},
  ) {
    this.inlineLimit = options.inlineLimit ?? DEFAULT_PAYLOAD_INLINE_LIMIT
  }

  async write(event: TraceEvent): Promise<TraceEvent> {
    const next = await this.maybeSpillPayload(event)
    await appendFile(this.layout.tracePath, `${JSON.stringify(next)}\n`, 'utf8')
    return next
  }

  private async maybeSpillPayload(event: TraceEvent): Promise<TraceEvent> {
    if (!event.payload) return event
    const raw = JSON.stringify(event.payload)
    if (Buffer.byteLength(raw, 'utf8') <= this.inlineLimit) return event

    const ref = `${event.id || randomUUID()}.json`
    await writeFile(join(this.layout.payloadsDir, ref), raw, 'utf8')
    const { payload: _drop, ...rest } = event
    return { ...rest, payloadRef: ref }
  }
}
