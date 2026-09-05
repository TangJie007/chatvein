import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages'
import type { BaseMessage } from '@langchain/core/messages'
import { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { ChatResult } from '@langchain/core/outputs'
import { FakeListChatModel } from '@langchain/core/utils/testing'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CHATVEIN_AGENTS_VERSION,
  createReactChatAgent,
  defineAgentTool,
  invokeReactChatAgent,
  WorkspaceCheckpointer,
} from '../index'

/** createAgent 走 _generate；FakeList 对 AIMessage 工具调用不友好，测试用脚本模型 */
class ScriptedChatModel extends BaseChatModel {
  private readonly queue: AIMessage[]
  private index = 0

  constructor(responses: AIMessage[]) {
    super({})
    this.queue = responses
  }

  _llmType(): string {
    return 'scripted'
  }

  async _generate(_messages: BaseMessage[]): Promise<ChatResult> {
    const message = this.queue[this.index++]
    if (!message) throw new Error('ScriptedChatModel: 响应队列已空')
    const text = typeof message.content === 'string' ? message.content : ''
    return { generations: [{ message, text }] }
  }

  bindTools(): this {
    return this
  }
}

describe('@chatvein/agents', () => {
  it('exports version', () => {
    expect(CHATVEIN_AGENTS_VERSION).toBe('0.1.0')
  })
})

describe('createReactChatAgent (最简 ReAct / createAgent)', () => {
  it('无工具：模型直接回答', async () => {
    const model = new FakeListChatModel({ responses: ['你好，我是助手'] })
    const agent = createReactChatAgent({
      model,
      tools: [],
      systemPrompt: '你是助手',
    })
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

    const model = new ScriptedChatModel([
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
    ])

    const agent = createReactChatAgent({ model, tools: [echo] })
    const result = await invokeReactChatAgent(agent, { message: '请 echo ping' })

    expect(result.content).toBe('工具结果是 echo:ping')
    // Human + AI(tool_call) + Tool + AI(final)
    expect(result.messages.length).toBe(4)
  })
})

describe('createReactChatAgent + WorkspaceCheckpointer（有状态持久化）', () => {
  it('真实 ReAct invoke 把完整轨迹落盘，可跨实例读取', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cp-e2e-'))
    try {
      const dbPath = join(dir, 'checkpoints.db')
      const cp = new WorkspaceCheckpointer({ dbPath })

      const echo = defineAgentTool({
        name: 'echo',
        description: '回显文本',
        schema: z.object({ text: z.string() }),
        invoke: ({ text }) => `echo:${text}`,
      })
      const model = new ScriptedChatModel([
        new AIMessage({
          content: '',
          tool_calls: [{ name: 'echo', args: { text: 'ping' }, id: 'call_1', type: 'tool_call' }],
        }),
        new AIMessage('工具结果是 echo:ping'),
      ])

      const agent = createReactChatAgent({ model, tools: [echo], checkpointer: cp })
      const result = await invokeReactChatAgent(agent, { message: '请 echo ping', threadId: 'conv-e2e' })
      expect(result.content).toBe('工具结果是 echo:ping')

      // 关闭后换一个实例，验证轨迹真正持久化到 SQLite（跨进程/跨实例）
      cp.close()
      const cp2 = new WorkspaceCheckpointer({ dbPath })
      const tuple = await cp2.getTuple({ configurable: { thread_id: 'conv-e2e' } })
      expect(tuple).toBeDefined()
      const msgs = tuple!.checkpoint.channel_values.messages as unknown[]
      // Human + AI(tool_call) + Tool + AI(final)
      expect(msgs.length).toBe(4)
      expect(HumanMessage.isInstance(msgs[0])).toBe(true)
      expect(ToolMessage.isInstance(msgs[2])).toBe(true)
      cp2.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
