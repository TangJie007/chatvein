/**
 * 稠密向量余弦相似度：委托 `ml-distance`（mljs）。
 */
import { similarity } from 'ml-distance'

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0
  return similarity.cosine(a, b)
}
