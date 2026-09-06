import { describe, expect, it } from 'vitest'
import {
  CHATVEIN_VECTOR_VERSION,
  BGE_SMALL_ZH_DIMENSIONS,
  BGE_SMALL_ZH_ONNX_MODEL,
  cosineSimilarity,
  createLocalVectorStore,
  type EmbeddingProvider,
} from '../index'

class FakeEmbedder implements EmbeddingProvider {
  readonly modelId = 'fake'
  readonly dimensions = 4

  async embed(text: string): Promise<Float32Array> {
    const [v] = await this.embedBatch([text])
    return v!
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    return texts.map((t) => {
      // 简单可区分向量：按字符码
      const a = (t.codePointAt(0) ?? 0) / 200
      const b = (t.codePointAt(1) ?? 0) / 200
      const v = new Float32Array([a, b, 0.1, 0.2])
      const n = Math.hypot(v[0]!, v[1]!, v[2]!, v[3]!) || 1
      return new Float32Array([v[0]! / n, v[1]! / n, v[2]! / n, v[3]! / n])
    })
  }
}

describe('@chatvein/vector', () => {
  it('exports version and model constants', () => {
    expect(CHATVEIN_VECTOR_VERSION).toBe('0.1.0')
    expect(BGE_SMALL_ZH_DIMENSIONS).toBe(512)
    expect(BGE_SMALL_ZH_ONNX_MODEL).toContain('bge-small-zh')
  })

  it('cosineSimilarity is 1 for identical vectors', () => {
    const a = new Float32Array([1, 0, 0])
    expect(cosineSimilarity(a, a)).toBeCloseTo(1)
  })

  it('LocalVectorStore upsert + search with fake embedder', async () => {
    const store = createLocalVectorStore({ embedder: new FakeEmbedder() })
    await store.init()
    await store.upsert([
      { content: '苹果手机', kind: 'doc', scope: 'global' },
      { content: '香蕉水果', kind: 'doc', scope: 'global' },
      { content: '苹果派食谱', kind: 'doc', scope: 'global' },
    ])
    expect(await store.count()).toBe(3)

    const hits = await store.search('苹果', { topK: 2 })
    expect(hits.length).toBe(2)
    expect(hits[0]!.content).toMatch(/苹果/)

    await store.close()
  })
})
