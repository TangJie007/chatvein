/**
 * 模型构造单测：`streaming` **默认开启**（只有显式 `false` 才关）。
 *
 * 这里把 `@langchain/openai` 换成只记录入参的假类，避免真去建 SDK 实例。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createChatModel } from '../create-chat-model'

const ctor = vi.hoisted(() => ({ fields: [] as unknown[] }))

vi.mock('@langchain/openai', () => ({
  ChatOpenAI: class {
    constructor(fields: unknown) {
      ctor.fields.push(fields)
    }
  },
}))

beforeEach(() => {
  ctor.fields.length = 0
})

describe('createChatModel', () => {
  it('streaming 默认开启', () => {
    createChatModel({ model: 'gpt-4o' })
    expect(ctor.fields[0]).toMatchObject({ streaming: true, streamUsage: true })
  })

  it('显式 streaming: false 才关闭', () => {
    createChatModel({ model: 'gpt-4o' }, { streaming: false })
    expect(ctor.fields[0]).not.toHaveProperty('streaming')
    expect(ctor.fields[0]).not.toHaveProperty('streamUsage')
  })

  it('模型名必填', () => {
    expect(() => createChatModel({ model: '   ' })).toThrow(
      /cfg\.model is required/,
    )
  })

  it('连接参数映射到模型入参', () => {
    createChatModel({
      model: 'deepseek-chat',
      apiKey: 'k',
      baseUrl: 'https://example.invalid/v1',
      temperature: 0.2,
    })

    expect(ctor.fields[0]).toMatchObject({
      model: 'deepseek-chat',
      apiKey: 'k',
      temperature: 0.2,
      configuration: { baseURL: 'https://example.invalid/v1' },
    })
  })
})
