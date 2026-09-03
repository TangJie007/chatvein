import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { TraceSink } from './index'

describe('TraceSink', () => {
  let root = ''

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true })
  })

  it('事件追加写入 trace.jsonl 并通知总线', async () => {
    root = await mkdtemp(join(tmpdir(), 'chatvein-obs-'))
    const sink = await TraceSink.create({ runsRoot: root, runId: 'run-1' })
    const seen: string[] = []
    sink.bus.on((e) => seen.push(e.kind))

    await sink.emit('info', { name: 'hello', payload: { n: 1 } })

    const lines = (await readFile(sink.layout.tracePath, 'utf8')).trim().split('\n')
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0]).kind).toBe('info')
    expect(seen).toEqual(['info'])
  })

  it('大 payload 外置为 payloadRef', async () => {
    root = await mkdtemp(join(tmpdir(), 'chatvein-obs-'))
    const sink = await TraceSink.create({
      runsRoot: root,
      runId: 'run-2',
      inlineLimit: 64,
    })

    const written = await sink.emit('model_call', {
      payload: { blob: 'x'.repeat(200) },
    })

    expect(written.payload).toBeUndefined()
    expect(written.payloadRef).toBeTruthy()
    const spilled = await readFile(join(sink.layout.payloadsDir, written.payloadRef!), 'utf8')
    expect(JSON.parse(spilled).blob.length).toBe(200)
  })
})
