/**
 * 本地中文嵌入：Transformers.js + onnx-community/bge-small-zh-v1.5-ONNX
 * 维度 512；mean/cls pooling + L2 normalize，适配检索。
 */
import { env, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers'
import type { EmbeddingProvider } from '../types'

/** HF 模型 id（ONNX，Transformers.js 兼容） */
export const BGE_SMALL_ZH_ONNX_MODEL = 'onnx-community/bge-small-zh-v1.5-ONNX'

/** BAAI/bge-small-zh-v1.5 输出维 */
export const BGE_SMALL_ZH_DIMENSIONS = 512

export interface BgeZhEmbedderOptions {
  /** 覆盖默认模型 id */
  modelId?: string
  /** 本地缓存目录（默认 HuggingFace cache） */
  cacheDir?: string
  /**
   * 远端模型主机（Transformers.js `env.remoteHost`）。
   * 默认读 `HF_ENDPOINT` / `CHATVEIN_HF_ENDPOINT`，再回落官方 Hub。
   * 国内可设 `https://hf-mirror.com/`。
   */
  remoteHost?: string
  /** 是否允许远端拉权重（CI/离线可关） */
  allowRemoteModels?: boolean
  /** 量化 dtype；Node 默认 q8 更省内存 */
  dtype?: 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16'
  pooling?: 'mean' | 'cls'
}

export class BgeZhEmbedder implements EmbeddingProvider {
  readonly modelId: string
  readonly dimensions = BGE_SMALL_ZH_DIMENSIONS

  private pipe: FeatureExtractionPipeline | null = null
  private readonly opts: Required<
    Pick<BgeZhEmbedderOptions, 'dtype' | 'pooling' | 'allowRemoteModels'>
  > &
    BgeZhEmbedderOptions

  constructor(options: BgeZhEmbedderOptions = {}) {
    this.modelId = options.modelId ?? BGE_SMALL_ZH_ONNX_MODEL
    this.opts = {
      ...options,
      dtype: options.dtype ?? 'q8',
      pooling: options.pooling ?? 'mean',
      allowRemoteModels: options.allowRemoteModels ?? true,
      remoteHost: options.remoteHost ?? defaultRemoteHost(),
    }
  }

  /** 懒加载 pipeline（首次 embed 时下载/读缓存） */
  async init(): Promise<void> {
    if (this.pipe) return
    if (this.opts.cacheDir) {
      env.cacheDir = this.opts.cacheDir
    }
    env.allowRemoteModels = this.opts.allowRemoteModels
    if (this.opts.remoteHost?.trim()) {
      env.remoteHost = normalizeRemoteHost(this.opts.remoteHost)
    }
    this.pipe = await pipeline('feature-extraction', this.modelId, {
      dtype: this.opts.dtype,
    })
  }

  async embed(text: string): Promise<Float32Array> {
    const [v] = await this.embedBatch([text])
    return v!
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return []
    await this.init()
    const extractor = this.pipe!
    const out: Float32Array[] = []
    for (const text of texts) {
      const tensor = await extractor(text, {
        pooling: this.opts.pooling,
        normalize: true,
      })
      out.push(tensorToFloat32(tensor, this.dimensions))
    }
    return out
  }

  async dispose(): Promise<void> {
    if (this.pipe && typeof (this.pipe as { dispose?: () => Promise<void> }).dispose === 'function') {
      await (this.pipe as { dispose: () => Promise<void> }).dispose()
    }
    this.pipe = null
  }
}

export function createBgeZhEmbedder(options?: BgeZhEmbedderOptions): BgeZhEmbedder {
  return new BgeZhEmbedder(options)
}

/** 官方 Hub；国内可设环境变量指向 hf-mirror 等 */
function defaultRemoteHost(): string {
  const fromEnv =
    process.env.CHATVEIN_HF_ENDPOINT?.trim() ||
    process.env.HF_ENDPOINT?.trim() ||
    ''
  return fromEnv || 'https://huggingface.co/'
}

function normalizeRemoteHost(host: string): string {
  const t = host.trim()
  return t.endsWith('/') ? t : `${t}/`
}

function tensorToFloat32(tensor: unknown, expectedDim: number): Float32Array {
  // Transformers.js Tensor：.data 为 TypedArray，.dims 为形状
  const t = tensor as { data?: ArrayLike<number>; dims?: number[]; tolist?: () => unknown }
  let data: ArrayLike<number>
  if (t?.data) {
    data = t.data
  } else if (typeof t?.tolist === 'function') {
    const list = t.tolist()
    data = flattenNumbers(list)
  } else if (Array.isArray(tensor) || ArrayBuffer.isView(tensor)) {
    data = tensor as ArrayLike<number>
  } else {
    throw new Error('BgeZhEmbedder: unexpected embedding tensor shape')
  }

  const arr = data instanceof Float32Array ? data : Float32Array.from(data as ArrayLike<number>)
  if (arr.length === expectedDim) return arr
  // 偶发 [1, dim]
  if (arr.length > expectedDim && arr.length % expectedDim === 0) {
    return arr.subarray(arr.length - expectedDim)
  }
  if (arr.length !== expectedDim) {
    console.warn(
      `[BgeZhEmbedder] dim mismatch: got ${arr.length}, expected ${expectedDim}`,
    )
  }
  return arr
}

function flattenNumbers(value: unknown): number[] {
  if (typeof value === 'number') return [value]
  if (!Array.isArray(value)) return []
  const out: number[] = []
  for (const item of value) {
    if (typeof item === 'number') out.push(item)
    else out.push(...flattenNumbers(item))
  }
  return out
}
