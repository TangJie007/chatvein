/**
 * L1 规则层 + 语义层单测（纯离线，不依赖真实模型）。
 */
import { describe, expect, it } from 'vitest'
import {
  cosineSimilarity,
  decideBySemantic,
  decideL1,
  extractFacts,
  getRoutePrototypeCorpusVersion,
  getRoutePrototypeSeed,
  isGreetingOnly,
  listRoutePrototypeDocs,
  prototypeStats,
  prototypeTotal,
  ROUTE_PROTOTYPE_TABLE,
  runL1,
  type EmbedPort,
  type PrototypeSearchPort,
} from '../l1'

describe('extractFacts', () => {
  it('寒暄', () => {
    const f = extractFacts('你好')
    expect(f.social.greetingOnly).toBe(true)
  })

  it('代码 path:line + 报错', () => {
    const f = extractFacts('修一下 src/index.ts:12 的 TypeError: x')
    expect(f.code.pathWithLine.length).toBeGreaterThan(0)
    expect(f.code.errorLike).toBe(true)
    expect(f.files.codeExt).toBe(true)
  })

  it('办公扩展名与附件', () => {
    const f = extractFacts({
      text: '处理一下',
      attachments: [{ name: '合同.pdf', mime: 'application/pdf' }],
    })
    expect(f.files.officeExt).toBe(true)
    expect(f.files.fromAttachments).toBe(true)
  })

  it('指代信号', () => {
    expect(extractFacts('它怎么改').needsHistory).toBe(true)
  })

  it('多步骤连接词', () => {
    const f = extractFacts('先解析 PDF 然后抽取条款并且导出 xlsx')
    expect(f.keywords.multiStep.length).toBeGreaterThan(0)
    expect(f.utterance.multiStep || f.keywords.office.length > 0).toBe(true)
  })
})

describe('decideL1', () => {
  it('寒暄 → direct·general', () => {
    const r = decideL1(extractFacts('你好啊'))
    expect(r.kind).toBe('decide')
    if (r.kind === 'decide') {
      expect(r.lane).toBe('direct')
      expect(r.domain).toBe('general')
      expect(r.decidedBy).toBe('rule')
    }
  })

  it('修类型报错 → agentic·code', () => {
    const r = decideL1(extractFacts('修一下 src/app.ts 的类型报错'))
    expect(r.kind).toBe('decide')
    if (r.kind === 'decide') {
      expect(r.lane).toBe('agentic')
      expect(r.domain).toBe('code')
    }
  })

  it('PDF 抽取 → agentic·general', () => {
    const r = decideL1(
      extractFacts({
        text: '把这份 PDF 条款抽成表',
        attachments: [{ name: 'a.pdf' }],
      }),
    )
    expect(r.kind).toBe('decide')
    if (r.kind === 'decide') {
      expect(r.domain).toBe('general')
      expect(r.lane).toBe('agentic')
    }
  })

  it('办公缺文件 → clarification', () => {
    const r = decideL1(extractFacts('帮我解析抽取转换导出'))
    expect(r.kind).toBe('decide')
    if (r.kind === 'decide') {
      expect(r.clarification?.question).toBeTruthy()
    }
  })

  it('短概念问 → direct', () => {
    const r = decideL1(extractFacts('什么是闭包'))
    expect(r.kind).toBe('decide')
    if (r.kind === 'decide') {
      expect(r.lane).toBe('direct')
      expect(r.reason).toBe('short-question')
    }
  })

  it('仅指代 → pass', () => {
    const r = decideL1(extractFacts('它怎么改'))
    expect(r.kind).toBe('pass')
  })
})

describe('DEFAULT_PROTOTYPES coverage', () => {
  it('每类至少 20 条，总量足够当语义主力', () => {
    const stats = prototypeStats()
    expect(prototypeTotal()).toBeGreaterThanOrEqual(150)
    for (const [key, n] of Object.entries(stats)) {
      expect(n, key).toBeGreaterThanOrEqual(20)
    }
  })
})

describe('route prototype corpus seed', () => {
  it('docs / version / table 可傻瓜建表', () => {
    const seed = getRoutePrototypeSeed()
    expect(seed.table).toBe(ROUTE_PROTOTYPE_TABLE)
    expect(seed.version).toMatch(/^[a-f0-9]{16}$/)
    expect(seed.docs.length).toBe(prototypeTotal())
    expect(listRoutePrototypeDocs().length).toBe(seed.docs.length)
    expect(getRoutePrototypeCorpusVersion()).toBe(seed.version)
    const first = seed.docs[0]!
    expect(first.id).toContain('|')
    expect(first.metadata.lane).toBeTruthy()
    expect(first.metadata.domain).toBeTruthy()
  })
})

describe('isGreetingOnly', () => {
  it('纯寒暄', () => {
    expect(isGreetingOnly('你好')).toBe(true)
    expect(isGreetingOnly('你好，帮我改 bug')).toBe(false)
  })
})

describe('cosineSimilarity', () => {
  it('相同向量 → 1', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1)
  })
  it('正交 → 0', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0)
  })
})

describe('semantic + runL1', () => {
  const embed: EmbedPort = {
    async embedQuery(text: string) {
      // 极简 bag：含「重构」偏 code orchestrated；含「天气」偏 general
      if (text.includes('重构') || text.includes('跨模块')) return [1, 0, 0]
      if (text.includes('天气')) return [0, 1, 0]
      if (text.includes('PDF') || text.includes('抽取')) return [0, 0, 1]
      return [0.1, 0.1, 0.1]
    },
    async embedDocuments(texts: string[]) {
      return Promise.all(texts.map((t) => this.embedQuery(t)))
    },
  }

  it('规则未定案时语义可定案', async () => {
    const r = await decideBySemantic('跨模块改造认证并补测试', {
      embed,
      prototypes: [
        {
          lane: 'orchestrated',
          domain: 'code',
          texts: ['重构跨模块改造'],
        },
        {
          lane: 'direct',
          domain: 'general',
          texts: ['今天天气怎么样'],
        },
      ],
      acceptThreshold: 0.8,
      semanticThreshold: 0.7,
    })
    expect(r?.kind).toBe('decide')
    expect(r?.lane).toBe('orchestrated')
    expect(r?.domain).toBe('code')
    expect(r?.decidedBy).toBe('semantic')
  })

  it('runL1 规则优先于语义', async () => {
    const r = await runL1('你好', { embed })
    expect(r.kind).toBe('decide')
    if (r.kind === 'decide') {
      expect(r.decidedBy).toBe('rule')
      expect(r.lane).toBe('direct')
    }
  })

  it('search 端口优先于 embed', async () => {
    let embedCalls = 0
    const embedSpy: EmbedPort = {
      async embedQuery(text: string) {
        embedCalls += 1
        return embed.embedQuery(text)
      },
    }
    const search: PrototypeSearchPort = {
      async search() {
        return [
          {
            lane: 'orchestrated',
            domain: 'code',
            score: 0.92,
            text: '跨模块重构',
          },
          {
            lane: 'direct',
            domain: 'general',
            score: 0.4,
            text: '闲聊',
          },
        ]
      },
    }
    const r = await decideBySemantic('任意查询', {
      search,
      embed: embedSpy,
      acceptThreshold: 0.8,
      semanticThreshold: 0.7,
    })
    expect(r?.kind).toBe('decide')
    expect(r?.lane).toBe('orchestrated')
    expect(r?.domain).toBe('code')
    expect(embedCalls).toBe(0)
  })
})
