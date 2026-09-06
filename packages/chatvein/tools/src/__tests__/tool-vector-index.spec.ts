import { describe, it, expect } from 'vitest'
import {
  ToolVectorIndex,
  type ToolEmbedder,
  type ToolVectorStore,
  type ToolIndexRecord,
  type ToolIndexHit,
} from '../tool-vector-index'

/** 确定性假嵌入器：由文本派生固定 4 维向量（无需 ONNX / 网络） */
class FakeEmbedder implements ToolEmbedder {
  readonly modelId = 'fake'
  readonly dimensions = 4
  embed(text: string): Promise<Float32Array> {
    return Promise.resolve(floatOf(text))
  }
  embedBatch(texts: string[]): Promise<Float32Array[]> {
    return Promise.all(texts.map((t) => this.embed(t)))
  }
}

function floatOf(text: string): Float32Array {
  const v = new Float32Array(4)
  for (let i = 0; i < text.length; i++) v[i % 4] += text.charCodeAt(i)
  return v
}

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!
  return s
}

/** 内存假向量库：按与 query 向量的点积排序返回 */
class FakeStore implements ToolVectorStore {
  private recs: ToolIndexRecord[] = []
  async upsert(records: readonly ToolIndexRecord[]): Promise<string[]> {
    this.recs.push(...records)
    return records.map((r) => r.id)
  }
  async search(query: string, options?: { topK?: number }): Promise<ToolIndexHit[]> {
    const q = floatOf(query)
    const scored = this.recs.map((r) => ({
      id: r.id,
      score: dot(q, floatOf(r.content)),
      meta: r.meta ?? {},
    }))
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, options?.topK ?? 8)
  }
}

describe('ToolVectorIndex', () => {
  it('build 后 ready；select 在候选内按相关度返回 id', async () => {
    const idx = new ToolVectorIndex({ embedder: new FakeEmbedder(), store: new FakeStore() })
    expect(idx.ready).toBe(false)
    await idx.build([{ name: 'filesystem__read' }, { name: 'calculator' }])
    expect(idx.ready).toBe(true)
    const res = await idx.select('read a file', ['filesystem__read', 'calculator'], 24)
    expect(res).toContain('filesystem__read')
  })

  it('未就绪时 select 返回 []（上层回退全候选）', async () => {
    const idx = new ToolVectorIndex({ embedder: new FakeEmbedder(), store: new FakeStore() })
    expect(await idx.select('query', ['a'])).toEqual([])
  })

  it('select 仅返回候选内的 id，排除无关但已索引的工具', async () => {
    const idx = new ToolVectorIndex({ embedder: new FakeEmbedder(), store: new FakeStore() })
    await idx.build([{ name: 'filesystem__read' }, { name: 'calculator' }])
    const res = await idx.select('read', ['calculator'])
    expect(res).not.toContain('filesystem__read')
  })

  it('空 query 返回 []', async () => {
    const idx = new ToolVectorIndex({ embedder: new FakeEmbedder(), store: new FakeStore() })
    await idx.build([{ name: 'filesystem__read' }])
    expect(await idx.select('   ', ['filesystem__read'])).toEqual([])
  })
})
