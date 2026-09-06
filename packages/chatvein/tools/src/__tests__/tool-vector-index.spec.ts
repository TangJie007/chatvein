import { describe, it, expect } from 'vitest'
import {
  ToolVectorIndex,
  TOOL_INDEX_SCOPE,
  TOOL_INDEX_KIND,
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

/** 内存假向量库：按与 query 向量的点积排序返回；同 id 覆盖（对齐 mergeInsert 语义） */
class FakeStore implements ToolVectorStore {
  private recs: ToolIndexRecord[] = []
  async upsert(records: readonly ToolIndexRecord[]): Promise<string[]> {
    for (const r of records) {
      const i = this.recs.findIndex((x) => x.id === r.id)
      if (i >= 0) this.recs[i] = r
      else this.recs.push(r)
    }
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
  async remove(ids: readonly string[]): Promise<number> {
    const gone = new Set(ids)
    const before = this.recs.length
    this.recs = this.recs.filter((r) => !gone.has(r.id))
    return before - this.recs.length
  }
  size(): number {
    return this.recs.length
  }
  has(id: string): boolean {
    return this.recs.some((r) => r.id === id)
  }
}

describe('ToolVectorIndex', () => {
  it('build 后 ready；select 在候选内按相关度返回 id', async () => {
    const idx = new ToolVectorIndex({ embedder: new FakeEmbedder(), store: new FakeStore() })
    expect(idx.ready).toBe(false)
    await idx.build([{ name: 'filesystem__read' }, { name: 'calculator' }])
    expect(idx.ready).toBe(true)
    expect(idx.lexicalSize).toBe(2)
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

  it('select 固定 Top-K，不再用候选数抬高召回量', async () => {
    const tools = Array.from({ length: 20 }, (_, i) => ({
      name: `tool_${i}`,
      description: `desc ${i} shared topic file write`,
    }))
    const idx = new ToolVectorIndex({ embedder: new FakeEmbedder(), store: new FakeStore() })
    await idx.build(tools)
    const names = tools.map((t) => t.name)
    const res = await idx.select('file write', names, 5)
    expect(res.length).toBeLessThanOrEqual(5)
  })

  it('别名 BM25 能在向量弱相关时抬升工具名命中', async () => {
    const idx = new ToolVectorIndex({
      embedder: new FakeEmbedder(),
      store: new FakeStore(),
      lexicalWeight: 3,
      vectorWeight: 0.1,
    })
    await idx.build([
      { name: 'filesystem__write_file', description: 'zzz unrelated embed blob' },
      { name: 'weather_lookup', description: 'file write shared topic noise' },
    ])
    const res = await idx.select('写文件', ['filesystem__write_file', 'weather_lookup'], 2)
    expect(res[0]).toBe('filesystem__write_file')
  })

  it('recordsFor 产出 scope/kind 对齐 TOOL_INDEX 的记录（不触发嵌入）', () => {
    const store = new FakeStore()
    const idx = new ToolVectorIndex({ embedder: new FakeEmbedder(), store })
    // 使用非目录 id，避免 catalog 覆盖 description
    const recs = idx.recordsFor([{ name: 'custom_math_tool', description: '数学计算' }])
    expect(recs).toHaveLength(1)
    expect(recs[0]!.id).toBe('custom_math_tool')
    expect(recs[0]!.scope).toBe(TOOL_INDEX_SCOPE)
    expect(recs[0]!.kind).toBe(TOOL_INDEX_KIND)
    expect(recs[0]!.content).toContain('数学计算')
    expect(store.size()).toBe(0) // 纯文本层，不写库
  })

  it('sync 差量补录不改变 ready；select 仍走回退', async () => {
    const store = new FakeStore()
    const idx = new ToolVectorIndex({ embedder: new FakeEmbedder(), store })
    const recs = idx.recordsFor([{ name: 'calculator', description: '数学计算' }])
    await idx.sync(recs)
    expect(idx.ready).toBe(false)
    expect(store.has('calculator')).toBe(true)
    expect(await idx.select('算一下', ['calculator'])).toEqual([])
  })

  it('markReady(tools) 在不写库时 hydrate BM25 并允许 select', async () => {
    const store = new FakeStore()
    const idx = new ToolVectorIndex({ embedder: new FakeEmbedder(), store })
    const tools = [{ name: 'calculator', description: '数学计算' }]
    await idx.sync(idx.recordsFor(tools))
    expect(idx.ready).toBe(false)
    idx.markReady(tools)
    expect(idx.ready).toBe(true)
    expect(idx.lexicalSize).toBe(1)
    expect(await idx.select('计算', ['calculator'])).toContain('calculator')
  })

  it('purge 删除指定 id，不影响其余记录', async () => {
    const store = new FakeStore()
    const idx = new ToolVectorIndex({ embedder: new FakeEmbedder(), store })
    await idx.build([{ name: 'a' }, { name: 'b' }, { name: 'c' }])
    await idx.purge(['a', 'b'])
    expect(store.size()).toBe(1)
    expect(store.has('c')).toBe(true)
    expect(store.has('a')).toBe(false)
    expect(idx.lexicalSize).toBe(1)
  })

  it('replace 覆盖旧内容并标记 ready；重复 replace 不产生重复记录', async () => {
    const store = new FakeStore()
    const idx = new ToolVectorIndex({ embedder: new FakeEmbedder(), store })
    await idx.replace([{ name: 'calculator', description: '旧描述' }])
    expect(idx.ready).toBe(true)
    await idx.replace([{ name: 'calculator', description: '新描述' }])
    expect(store.size()).toBe(1)
    const res = await idx.select('新描述', ['calculator'])
    expect(res).toContain('calculator')
  })
})
