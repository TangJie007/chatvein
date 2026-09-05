import { describe, expect, it } from 'vitest'
import { AIMessage, HumanMessage } from '@langchain/core/messages'
import { aggregateTokenUsage, tokenUsageFromMessage } from '../react-agent'

describe('tokenUsageFromMessage', () => {
  it('reads usage_metadata', () => {
    const m = new AIMessage({
      content: 'hi',
      usage_metadata: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    })
    expect(tokenUsageFromMessage(m)).toEqual({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    })
  })

  it('sums across trajectory', () => {
    const usage = aggregateTokenUsage([
      new HumanMessage('q'),
      new AIMessage({
        content: '',
        usage_metadata: { input_tokens: 3, output_tokens: 1, total_tokens: 4 },
      }),
      new AIMessage({
        content: 'a',
        usage_metadata: { input_tokens: 8, output_tokens: 20, total_tokens: 28 },
      }),
    ])
    expect(usage).toEqual({ promptTokens: 11, completionTokens: 21, totalTokens: 32 })
  })
})
