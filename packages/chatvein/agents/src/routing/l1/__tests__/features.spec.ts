import { describe, expect, it } from 'vitest'
import { extractFacts, isGreetingOnly, isSelfIntro } from '../features'
import { resolveDict } from '../dict'

describe('extractFacts', () => {
  const session = {
    turnIndex: 0,
    lastAssistantHadTools: false,
    recentFailure: false,
    activeMode: 'chat' as const,
  }

  it('寒暄整句 → hitGreetingOnly', () => {
    const ctx = extractFacts('你好', session)
    expect(ctx.hitGreetingOnly).toBe(true)
    expect(ctx.lang).toBe('zh')
    expect(ctx.dictCoverage).toBe('full')
  })

  it('自我介绍短句 → hitSelfIntro', () => {
    expect(extractFacts('我叫唐杰', session).hitSelfIntro).toBe(true)
    expect(extractFacts('我的名字是张三', session).hitSelfIntro).toBe(true)
  })

  it('询问名字 / 带问号 → 不命中 selfIntro', () => {
    expect(extractFacts('我叫什么', session).hitSelfIntro).toBe(false)
    expect(extractFacts('我是谁', session).hitSelfIntro).toBe(false)
    expect(extractFacts('我叫啥', session).hitSelfIntro).toBe(false)
    expect(extractFacts('叫我什么', session).hitSelfIntro).toBe(false)
    expect(extractFacts('我叫唐杰？', session).hitSelfIntro).toBe(false)
    expect(extractFacts('我叫唐杰?', session).hitSelfIntro).toBe(false)
  })

  it('自我介绍夹任务 → 不命中 selfIntro', () => {
    expect(extractFacts('我叫唐杰，帮我写个登录', session).hitSelfIntro).toBe(false)
    expect(extractFacts('我是来改代码的', session).hitSelfIntro).toBe(false)
  })

  it('你好 + 长任务 → 不得 greeting only', () => {
    const ctx = extractFacts('你好，帮我设计一个分布式缓存', session)
    expect(ctx.hitGreetingOnly).toBe(false)
  })

  it('检测代码围栏与路径', () => {
    const ctx = extractFacts('看下 ./src/app.ts\n```ts\nconst x = 1\n```', session)
    expect(ctx.hasCodeFence).toBe(true)
    expect(ctx.hasPathLike).toBe(true)
  })

  it('slash 命令', () => {
    const ctx = extractFacts('/help 说明', session)
    expect(ctx.hasSlashCmd).toBe(true)
    expect(ctx.slashCmd).toBe('help')
  })

  it('非中文 → unsupported + coverage none', () => {
    const ctx = extractFacts('hello there', session)
    expect(ctx.lang).toBe('unsupported')
    expect(ctx.dictCoverage).toBe('none')
  })

  it('isGreetingOnly / isSelfIntro', () => {
    const { dict } = resolveDict('zh')
    expect(isGreetingOnly('你好呀', dict)).toBe(true)
    expect(isGreetingOnly('你好世界怎么实现', dict)).toBe(false)
    expect(isSelfIntro('我叫小明', dict)).toBe(true)
    expect(isSelfIntro('我是来改代码的', dict)).toBe(false)
    expect(isSelfIntro('我叫什么', dict)).toBe(false)
    expect(isSelfIntro('我叫小明？', dict)).toBe(false)
  })
})
