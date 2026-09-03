import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TRUNCATION,
  parseForgeConfig,
  forgeConfigSchema,
} from '../config'
import { DEFAULT_BUDGET } from '../types'

describe('parseForgeConfig', () => {
  it('合法配置通过校验', () => {
    const cfg = parseForgeConfig({
      models: {
        strong: [{ id: 's1', baseUrl: 'http://x', model: 'gpt-x' }],
        medium: [],
        weak: [],
      },
    })
    expect(cfg.models.strong[0]?.model).toBe('gpt-x')
    expect(cfg.parallelism).toBe(1)
    expect(cfg.sandbox.provider).toBe('local')
    expect(cfg.retry.maxAttempts).toBe(3)
    expect(cfg.budget).toEqual(DEFAULT_BUDGET)
    expect(cfg.tools.truncation.maxFileLines).toBe(DEFAULT_TRUNCATION.maxFileLines)
    expect(cfg.tools.execAllowlist).toContain('git')
  })

  it('模型端点缺 baseUrl 时报 ValidationError', () => {
    expect(() =>
      parseForgeConfig({
        models: { strong: [{ id: 's', model: 'm' }], medium: [], weak: [] },
      }),
    ).toThrow(/校验失败/)
  })

  it('parallelism 非正数被拒', () => {
    const r = forgeConfigSchema.safeParse({
      models: { strong: [], medium: [], weak: [] },
      parallelism: 0,
    })
    expect(r.success).toBe(false)
  })

  it('apiKey 可选，密钥不入必填', () => {
    const cfg = parseForgeConfig({
      models: {
        strong: [{ id: 's', baseUrl: 'http://x', model: 'm', apiKey: 'sk-secret' }],
        medium: [],
        weak: [],
      },
    })
    expect(cfg.models.strong[0]?.apiKey).toBe('sk-secret')
  })
})
