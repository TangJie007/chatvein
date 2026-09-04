import { describe, expect, it } from 'vitest'
import { extractFacts, isGreetingOnly } from '../features'
import { resolveDict } from '../../locales'

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

  it('你好 + 长任务 → 不得 greeting only', () => {
    const ctx = extractFacts('你好，帮我设计一个分布式缓存', session)
    expect(ctx.hitGreetingOnly).toBe(false)
    expect(ctx.hitTaskVerb).toBe(true)
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

  it('拉群意图与否定工具', () => {
    const g = extractFacts('拉个群一起评审', session)
    expect(g.hitGroupIntent).toBe(true)
    const n = extractFacts('只解释，不要改文件', session)
    expect(n.hitNegateTool).toBe(true)
  })

  it('英文无词典包 → coverage none', () => {
    const ctx = extractFacts('hello there', session)
    expect(ctx.lang).toBe('en')
    expect(ctx.dictCoverage).toBe('none')
  })

  it('isGreetingOnly 不因 includes 误伤', () => {
    const { dict } = resolveDict('zh')
    expect(isGreetingOnly('你好呀', dict)).toBe(true)
    expect(isGreetingOnly('你好世界怎么实现', dict)).toBe(false)
  })

  it('查询天气命中 tool 词典', () => {
    const ctx = extractFacts('查询一下今天北京的天气', session)
    expect(ctx.hitToolVerb).toBe(true)
    expect(ctx.hitGreetingOnly).toBe(false)
  })

  it('口语扩展：看下 / 只看不改 / 派 forge', () => {
    expect(extractFacts('看下日志里最近的报错', session).hitToolVerb).toBe(true)
    expect(extractFacts('只看不改，说说原因', session).hitNegateTool).toBe(true)
    expect(extractFacts('交给 forge 无人值守实现', session).hitForgeIntent).toBe(true)
    expect(extractFacts('你理解错了，我说的是缓存', session).hitCorrection).toBe(true)
  })
})
