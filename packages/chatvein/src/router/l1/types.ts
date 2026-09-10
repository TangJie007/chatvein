/**
 * L1 类型：事实抽取结果与判决。
 */
import type { Band, Domain, Lane } from '../types'

export interface L1Attachment {
  name: string
  mime?: string
}

export interface L1Input {
  text: string
  history?: Array<{ role: string; content: string }>
  attachments?: L1Attachment[]
}

/** 规则层抽取的结构化事实（不做终局之外的猜测） */
export interface Facts {
  textNorm: string
  charLen: number
  /** 代码围栏 / 反引号 / 路径行号 / 堆栈 / 报错 */
  code: {
    fence: boolean
    inlineTicks: number
    pathWithLine: string[]
    stackLike: boolean
    errorLike: boolean
  }
  /** 文件路径与办公/代码扩展名 */
  files: {
    paths: string[]
    extensions: string[]
    officeExt: boolean
    codeExt: boolean
    fromAttachments: boolean
  }
  /** 领域关键词命中 */
  keywords: {
    office: string[]
    code: string[]
    multiStep: string[]
  }
  /** 指令形态 */
  utterance: {
    isQuestion: boolean
    isImperative: boolean
    multiStep: boolean
  }
  /** 指代 / 续做 */
  needsHistory: boolean
  /** 寒暄 / 自我介绍（高置信 direct） */
  social: {
    greetingOnly: boolean
    selfIntro: boolean
  }
}

export interface L1Decision {
  kind: 'decide'
  decidedBy: 'rule' | 'semantic'
  lane: Lane
  domain: Domain
  band: Band
  confidence: number
  ambiguous: boolean
  query: {
    rewritten: string
    searchQuery?: string
    slots?: Record<string, unknown>
    intents?: string[]
  }
  reason: string
  needsHistory: boolean
  clarification?: { question: string; options?: string[] }
}

export interface L1Pass {
  kind: 'pass'
  facts: Facts
  reason: string
}

export type L1Result = L1Decision | L1Pass

/** 本地 embedding 端口（内存比对 / 测试用；生产优先用 PrototypeSearchPort） */
export interface EmbedPort {
  embedQuery(text: string): Promise<number[]>
  embedDocuments?(texts: string[]): Promise<number[][]>
}

/** 向量表检索命中（宿主 LanceDB search 后投影） */
export interface PrototypeSearchHit {
  lane: Lane
  domain: Domain
  /** 余弦相似度 ∈ [0,1]，越大越相似 */
  score: number
  text: string
  id?: string
}

/**
 * 生产语义端口：查「路由原型」向量表。
 * app 启动时用 getRoutePrototypeSeed() 建表，再注入此端口。
 */
export interface PrototypeSearchPort {
  search(query: string, topK?: number): Promise<PrototypeSearchHit[]>
}

export interface L1Options {
  /** ≥ 此值规则/语义可直接定案，默认 0.85 */
  acceptThreshold?: number
  /** 语义层最低分且需拉开次优，默认 0.78 */
  semanticThreshold?: number
  /**
   * 生产路径：向量表检索（优先于 embed）。
   * 与 embed 都不传 → 跳过语义层。
   */
  search?: PrototypeSearchPort
  /** 内存 embedding 比对（测试 / 无表降级） */
  embed?: EmbedPort
  /** 覆盖默认原型句（仅影响 embed 路径与语料导出调用方自行决定） */
  prototypes?: Array<{ lane: Lane; domain: Domain; texts: string[] }>
}


export interface L1Thresholds {
  accept: number
  semantic: number
  semanticMargin: number
}
