import { describe, expect, it } from 'vitest'
import { createL1Router } from '../router'

describe('L1HeuristicRouter', () => {
  const router = createL1Router()

  it('空消息 terminal empty', async () => {
    const d = await router.route({ text: '   ' })
    expect(d.terminal?.kind).toBe('empty')
    expect(d.confident).toBe(true)
  })

  it('寒暄 → trivial + weak + 无工具', async () => {
    const d = await router.route({ text: '谢谢' })
    expect(d.band).toBe('trivial')
    expect(d.policy.modelTier).toBe('weak')
    expect(d.policy.tools).toBe('none')
    expect(d.confident).toBe(true)
    expect(d.ruleIds).toContain('greeting_trivial')
  })

  it('自我介绍 → trivial + weak + 本地可短路', async () => {
    const d = await router.route({ text: '我叫唐杰' })
    expect(d.band).toBe('trivial')
    expect(d.policy.modelTier).toBe('weak')
    expect(d.policy.tools).toBe('none')
    expect(d.policy.maxSteps).toBe(0)
    expect(d.confident).toBe(true)
    expect(d.ruleIds).toContain('self_intro_trivial')
  })

  it('自我介绍夹任务 → 不走 trivial', async () => {
    const d = await router.route({ text: '我叫唐杰，帮我写个登录' })
    expect(d.band).not.toBe('trivial')
    expect(d.ruleIds).not.toContain('self_intro_trivial')
  })

  it('slash → terminal', async () => {
    const d = await router.route({ text: '/clear' })
    expect(d.terminal?.kind).toBe('slash')
    expect(d.terminal?.payload?.slashCmd).toBe('clear')
  })

  it('群 @ → terminal mention', async () => {
    const d = await router.route({
      text: '@架构师 看下方案',
      session: { activeMode: 'group' },
    })
    expect(d.terminal?.kind).toBe('mention')
  })

  it('代码+路径抬升复杂度', async () => {
    const d = await router.route({
      text: '请修复 ./src/main.ts 里的错误\n```ts\nfoo()\n```',
    })
    expect(d.score).toBeGreaterThanOrEqual(40)
    expect(['standard', 'complex', 'unknown']).toContain(d.band)
    expect(d.policy.tools).not.toBe('none')
  })

  it('拉群意图只 hint UI，不 terminal 建群', async () => {
    const d = await router.route({ text: '拉个群一起讨论架构' })
    expect(d.policy.hintUserCreateGroup).toBe(true)
    expect(d.terminal).toBeUndefined()
  })

  it('对比选型允许子 Agent', async () => {
    const d = await router.route({ text: '帮我做 Redis 和 Memcached 的选型权衡哪个更好' })
    expect(d.policy.allowSubAgents).toBe(true)
  })

  it('工具动词 → tools unknown（交 L2）', async () => {
    const d = await router.route({ text: '查询一下今天北京的天气' })
    expect(d.policy.tools).toBe('unknown')
  })

  it('否定工具 → tools none', async () => {
    const d = await router.route({ text: '解释一下闭包，不要改文件' })
    expect(d.policy.tools).toBe('none')
  })

  it('forceTier 覆盖', async () => {
    const d = await router.route({
      text: '你好',
      session: { forceTier: 'strong' },
    })
    expect(d.policy.modelTier).toBe('strong')
  })

  it('disabled → 保守 unknown', async () => {
    const r = createL1Router({ enabled: false })
    const d = await r.route({ text: '任意' })
    expect(d.band).toBe('unknown')
    expect(d.reasons).toContain('router_disabled')
  })
})
