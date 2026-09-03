import { describe, expect, it } from 'vitest'
import { ChatOpenAI } from '@langchain/openai'
import { createLangChainChatModel } from '../langchain-bridge'

describe('createLangChainChatModel', () => {
  it('从 OpenAICompatibleConfig 构建 ChatOpenAI（供 LangGraph）', () => {
    const llm = createLangChainChatModel({
      id: 'bridge-1',
      baseUrl: 'https://example.com/v1/',
      apiKey: 'sk-test',
      model: 'gpt-test',
      temperature: 0.1,
    })
    expect(llm).toBeInstanceOf(ChatOpenAI)
    expect(llm.model).toBe('gpt-test')
  })
})
