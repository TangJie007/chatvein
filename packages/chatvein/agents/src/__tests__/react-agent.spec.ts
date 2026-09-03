import { AIMessage } from '@langchain/core/messages'
import { FakeListChatModel } from '@langchain/core/utils/testing'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  CHATVEIN_AGENTS_VERSION,
  createReactChatAgent,
  defineAgentTool,
  invokeReactChatAgent,
} from '../index'

describe('@chatvein/agents', () => {
  it('exports version', () => {
    expect(CHATVEIN_AGENTS_VERSION).toBe('0.1.0')
  })
})

describe('createReactChatAgent (最简 ReAct)', () => {
  it('无工具：模型直接回答', async () => {
    const llm = new FakeListChatModel({ responses: ['你好，我是助手'] })
    const agent = createReactChatAgent({ llm, tools: [], systemPrompt: '你是助手' })
    const result = await invokeReactChatAgent(agent, { message: '你好' })
    expect(result.content).toBe('你好，我是助手')
    expect(result.messages.length).toBeGreaterThanOrEqual(2)
  })

  it('单工具闭环：调工具后再回答', async () => {
    const echo = defineAgentTool({
      name: 'echo',
      description: '回显文本',
      schema: z.object({ text: z.string() }),
      invoke: ({ text }) => `echo:${text}`,
    })

    const llm = new FakeListChatModel({
      responses: [
        new AIMessage({
          content: '',
          tool_calls: [
            {
              name: 'echo',
              args: { text: 'ping' },
              id: 'call_1',
              type: 'tool_call',
            },
          ],
        }),
        new AIMessage('工具结果是 echo:ping'),
      ],
    })

    const agent = createReactChatAgent({ llm, tools: [echo] })
    const result = await invokeReactChatAgent(agent, { message: '请 echo ping' })

    expect(result.content).toBe('工具结果是 echo:ping')
    // Human + AI(tool_call) + Tool + AI(final)
    expect(result.messages.length).toBe(4)
  })
})
