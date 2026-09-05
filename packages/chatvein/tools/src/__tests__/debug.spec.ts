import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { tool } from '@langchain/core/tools'
import { summarizeToolsForDebug } from '../debug'

describe('summarizeToolsForDebug', () => {
  it('includes name description and json schema', () => {
    const t = tool(async ({ q }) => q, {
      name: 'demo_search',
      description: 'demo',
      schema: z.object({ q: z.string().describe('query') }),
    })
    const rows = summarizeToolsForDebug([t])
    expect(rows).toHaveLength(1)
    expect(rows[0]!.name).toBe('demo_search')
    expect(rows[0]!.description).toBe('demo')
    expect(rows[0]!.parameters).toMatchObject({
      type: 'object',
      properties: { q: { type: 'string' } },
    })
  })
})
