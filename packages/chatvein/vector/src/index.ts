/**
 * @chatvein/vector
 *
 * 本地嵌入（Transformers.js + bge-small-zh ONNX）+ LanceDB 向量存储。
 * 见 docs/design/04-向量存储架构.md。
 */

export const CHATVEIN_VECTOR_VERSION = '0.1.0'

export type {
  EmbeddingProvider,
  StoredVector,
  VectorBrowseResult,
  VectorKind,
  VectorListOptions,
  VectorListRow,
  VectorRecord,
  VectorScope,
  VectorSearchFilter,
  VectorSearchHit,
  VectorTableInfo,
  VectorSearchOptions,
} from './types'

export {
  BGE_SMALL_ZH_DIMENSIONS,
  BGE_SMALL_ZH_ONNX_MODEL,
  BgeZhEmbedder,
  createBgeZhEmbedder,
  type BgeZhEmbedderOptions,
} from './embedders/bge-zh'

export {
  LocalVectorStore,
  cosineSimilarity,
  createLocalVectorStore,
  type LocalVectorStoreOptions,
} from './store'
