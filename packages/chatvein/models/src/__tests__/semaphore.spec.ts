import { describe, expect, it } from 'vitest'
import type { ChatMessage, ChatModelLike, ModelResult } from '@chatvein/common'
import { ConcurrencyLimitedChatModel, Semaphore } from '../semaphore'

const msgs: ChatMessage[] = [{ role: 'user', content: 'hi' }]

function okResult(): ModelResult {
  return {
    content: 'x',
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    model: 'm',
    latencyMs: 1,
  }
}

/** 让微任务/异步链全部落定 */
const flush = () => new Promise((r) => setTimeout(r, 0))

describe('Semaphore', () => {
  it('capacity 非法时抛错', () => {
    expect(() => new Semaphore(0)).toThrow()
    expect(() => new Semaphore(-2)).toThrow()
    expect(() => new Semaphore(1.5)).toThrow()
  })

  it('超额调用排队，release 后按 FIFO 放行', async () => {
    const sem = new Semaphore(2)
    const r1 = await sem.acquire()
    const r2 = await sem.acquire()
    expect(sem.inFlight).toBe(2)

    let acquired3 = false
    const p3 = sem.acquire().then((rel) => {
      acquired3 = true
      return rel
    })
    await flush()
    expect(sem.pending).toBe(1)
    expect(acquired3).toBe(false)

    r1() // 放行排队者
    const r3 = await p3
    expect(acquired3).toBe(true)
    expect(sem.inFlight).toBe(2) // 名额移交给 p3，仍占满

    r2()
    r3()
    expect(sem.inFlight).toBe(0)
    expect(sem.pending).toBe(0)
  })
})

describe('ConcurrencyLimitedChatModel', () => {
  it('并发永不超过 maxConcurrency，超额排队', async () => {
    let inFlight = 0
    let maxSeen = 0
    const gates: Array<() => void> = []
    const inner: ChatModelLike = {
      id: 'gated',
      invoke: async () => {
        inFlight++
        maxSeen = Math.max(maxSeen, inFlight)
        await new Promise<void>((res) => gates.push(res))
        inFlight--
        return okResult()
      },
    }
    const limited = new ConcurrencyLimitedChatModel(inner, { maxConcurrency: 2 })

    const p1 = limited.invoke(msgs)
    const p2 = limited.invoke(msgs)
    const p3 = limited.invoke(msgs) // 应排队
    await flush()

    expect(maxSeen).toBe(2)
    expect(limited.inFlight).toBe(2)
    expect(limited.pending).toBe(1)

    gates[0]!() // 完成第一个 → 放行 p3
    await p1
    await flush()
    expect(maxSeen).toBe(2) // 全程未突破 2

    gates[1]!()
    gates[2]!()
    await Promise.all([p2, p3])
    expect(limited.inFlight).toBe(0)
    expect(maxSeen).toBe(2)
  })

  it('maxConcurrency=1 时串行化', async () => {
    let inFlight = 0
    let maxSeen = 0
    const gates: Array<() => void> = []
    const inner: ChatModelLike = {
      id: 'serial',
      invoke: async () => {
        inFlight++
        maxSeen = Math.max(maxSeen, inFlight)
        await new Promise<void>((res) => gates.push(res))
        inFlight--
        return okResult()
      },
    }
    const limited = new ConcurrencyLimitedChatModel(inner, { maxConcurrency: 1 })
    const p1 = limited.invoke(msgs)
    const p2 = limited.invoke(msgs)
    await flush()
    expect(maxSeen).toBe(1)
    expect(limited.pending).toBe(1)
    gates[0]!()
    await p1
    await flush()
    expect(maxSeen).toBe(1)
    gates[1]!()
    await p2
  })

  it('内层抛错也释放名额，后续调用可继续', async () => {
    let calls = 0
    const inner: ChatModelLike = {
      id: 'flaky',
      invoke: async () => {
        calls++
        if (calls === 1) throw new Error('boom')
        return okResult()
      },
    }
    const limited = new ConcurrencyLimitedChatModel(inner, { maxConcurrency: 1 })
    await expect(limited.invoke(msgs)).rejects.toThrow('boom')
    const r = await limited.invoke(msgs) // 名额已释放，可继续
    expect(r.content).toBe('x')
    expect(calls).toBe(2)
  })
})
