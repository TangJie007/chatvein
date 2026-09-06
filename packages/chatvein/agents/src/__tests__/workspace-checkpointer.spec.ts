import { describe, it, expect, afterEach } from 'vitest'
import { AIMessage, HumanMessage } from '@langchain/core/messages'
import { WorkspaceCheckpointer } from '../checkpointer'
import { join } from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

function makeCheckpoint(id: string, messages: unknown[]) {
  return {
    v: 4,
    id,
    ts: new Date().toISOString(),
    channel_values: { messages },
    channel_versions: { messages: 1 },
    versions_seen: {},
  } as const
}

describe('WorkspaceCheckpointer', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const d of dirs) {
      try {
        rmSync(d, { recursive: true, force: true })
      } catch {
        // Windows 偶发句柄占用，忽略
      }
    }
    dirs.length = 0
  })

  function makeCp(): WorkspaceCheckpointer {
    const dir = mkdtempSync(join(tmpdir(), 'cp-test-'))
    dirs.push(dir)
    return new WorkspaceCheckpointer({ dbPath: join(dir, 'checkpoints.db') })
  }

  it('persists a checkpoint with LangChain BaseMessages and round-trips them', async () => {
    const cp = makeCp()
    try {
      const checkpoint = makeCheckpoint('cp-1', [new HumanMessage('hi'), new AIMessage('hello')])
      const metadata = { source: 'test', step: 1 }
      await cp.put({ configurable: { thread_id: 't1' } }, checkpoint as never, metadata as never)

      const tuple = await cp.getTuple({ configurable: { thread_id: 't1' } })
      expect(tuple).toBeDefined()
      expect(tuple!.checkpoint.id).toBe('cp-1')
      expect(tuple!.metadata).toMatchObject({ source: 'test', step: 1 })

      const msgs = tuple!.checkpoint.channel_values.messages as unknown[]
      expect(msgs).toHaveLength(2)
      expect(HumanMessage.isInstance(msgs[0])).toBe(true)
      expect(AIMessage.isInstance(msgs[1])).toBe(true)
      expect((msgs[0] as { content: string }).content).toBe('hi')
      expect((msgs[1] as { content: string }).content).toBe('hello')
    } finally {
      cp.close()
    }
  })

  it('stores pending writes and exposes them via getTuple, then deleteThread clears', async () => {
    const cp = makeCp()
    try {
      const checkpoint = makeCheckpoint('cp-2', [new HumanMessage('hi')])
      await cp.put(
        { configurable: { thread_id: 't2' } },
        checkpoint as never,
        { source: 'test' } as never,
      )
      await cp.putWrites(
        { configurable: { thread_id: 't2', checkpoint_ns: '', checkpoint_id: 'cp-2' } },
        [['messages', new AIMessage('tool result')]],
        'task-1',
      )

      const tuple = await cp.getTuple({ configurable: { thread_id: 't2' } })
      expect(tuple).toBeDefined()
      const pending = tuple!.pendingWrites ?? []
      expect(pending.length).toBe(1)
      expect(pending[0]![1]).toBe('messages')
      expect(AIMessage.isInstance(pending[0]![2])).toBe(true)

      await cp.deleteThread('t2')
      expect(await cp.getTuple({ configurable: { thread_id: 't2' } })).toBeUndefined()
    } finally {
      cp.close()
    }
  })

  it('isolation: different thread_ids do not leak', async () => {
    const cp = makeCp()
    try {
      await cp.put(
        { configurable: { thread_id: 'a' } },
        makeCheckpoint('cp-a', [new HumanMessage('A')]) as never,
        { source: 'test' } as never,
      )
      await cp.put(
        { configurable: { thread_id: 'b' } },
        makeCheckpoint('cp-b', [new HumanMessage('B')]) as never,
        { source: 'test' } as never,
      )

      const a = await cp.getTuple({ configurable: { thread_id: 'a' } })
      const b = await cp.getTuple({ configurable: { thread_id: 'b' } })
      expect((a!.checkpoint.channel_values.messages as unknown[])[0]).toMatchObject({ content: 'A' })
      expect((b!.checkpoint.channel_values.messages as unknown[])[0]).toMatchObject({ content: 'B' })
    } finally {
      cp.close()
    }
  })

  it('creates missing parent directories before opening the db', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cp-test-'))
    dirs.push(dir)
    const cp = new WorkspaceCheckpointer({ dbPath: join(dir, 'memory', 'checkpoints.db') })
    try {
      expect(cp).toBeDefined()
    } finally {
      cp.close()
    }
  })
})
