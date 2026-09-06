import { describe, expect, it } from 'vitest'
import { shouldEscalateToL2 } from '../../l2'
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
    expect(shouldEscalateToL2(d)).toBe(false)
  })

  it('寒暄开头夹真问题 → 不得 trivial，defer L2', async () => {
    const d = await router.route({ text: '你好，1+1等于多少' })
    expect(d.band).toBe('unknown')
    expect(d.confident).toBe(false)
    expect(d.reasons).toContain('defer_to_l2')
    expect(d.ruleIds).not.toContain('greeting_trivial')
    expect(shouldEscalateToL2(d)).toBe(true)
  })

  it('自我介绍 → trivial', async () => {
    const d = await router.route({ text: '我叫唐杰' })
    expect(d.band).toBe('trivial')
    expect(d.policy.maxSteps).toBe(0)
    expect(d.ruleIds).toContain('self_intro_trivial')
    expect(shouldEscalateToL2(d)).toBe(false)
  })

  it('自我介绍夹任务 → defer L2', async () => {
    const d = await router.route({ text: '我叫唐杰，帮我写个登录' })
    expect(d.band).toBe('unknown')
    expect(d.ruleIds).not.toContain('self_intro_trivial')
    expect(shouldEscalateToL2(d)).toBe(true)
  })

  it('我叫什么 → 不得 self_intro 短路，defer L2', async () => {
    const d = await router.route({ text: '我叫什么' })
    expect(d.band).toBe('unknown')
    expect(d.ruleIds).not.toContain('self_intro_trivial')
    expect(shouldEscalateToL2(d)).toBe(true)
  })

  it('任务请求 → defer L2', async () => {
    const d = await router.route({ text: '帮我整理vue3 的 响应式原理 整理成md文档' })
    expect(d.band).toBe('unknown')
    expect(d.reasons).toContain('defer_to_l2')
    expect(shouldEscalateToL2(d)).toBe(true)
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

  it('普通任务 → defer L2（无 L1 意图 bump）', async () => {
    const d = await router.route({
      text: '请修复 ./src/main.ts 里的错误\n```ts\nfoo()\n```',
    })
    expect(d.band).toBe('unknown')
    expect(d.confident).toBe(false)
    expect(d.reasons).toContain('defer_to_l2')
    expect(shouldEscalateToL2(d)).toBe(true)
  })

  it('forceTier 覆盖寒暄', async () => {
    const d = await router.route({
      text: '你好',
      session: { forceTier: 'strong' },
    })
    expect(d.band).toBe('trivial')
    expect(d.policy.modelTier).toBe('strong')
    expect(shouldEscalateToL2(d)).toBe(false)
  })

  it('disabled → 保守 unknown', async () => {
    const r = createL1Router({ enabled: false })
    const d = await r.route({ text: '任意' })
    expect(d.band).toBe('unknown')
    expect(d.reasons).toContain('router_disabled')
  })
})
