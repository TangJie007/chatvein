import { createContext, Script } from 'node:vm'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { z } from 'zod'
import { wrapToolGuards, defineBuiltinTool } from '../wrap'
import type { ToolSecrets } from '../types'

const DEFAULT_TIMEOUT = 8_000
const DEFAULT_MAX = 4_000

export async function createComputeTools(options: {
  ids: Set<string>
  secrets?: ToolSecrets
  timeoutMs?: number
  maxOutputChars?: number
}): Promise<StructuredToolInterface[]> {
  const out: StructuredToolInterface[] = []
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT
  const maxOutputChars = options.maxOutputChars ?? DEFAULT_MAX
  const guards = { timeoutMs, maxOutputChars }

  if (options.ids.has('calculator')) {
    const { Calculator } = await import('@langchain/community/tools/calculator')
    out.push(wrapToolGuards(new Calculator(), guards))
  }

  if (options.ids.has('js_eval')) {
    out.push(
      defineBuiltinTool({
        name: 'js_eval',
        description:
          'Evaluate a short JavaScript expression in a restricted VM (no require, no filesystem, no network). Return the stringified result.',
        schema: z.object({
          code: z.string().describe('JS expression or statements; last expression value is returned'),
        }),
        timeoutMs,
        maxOutputChars,
        invoke: ({ code }) => {
          const sandbox = createContext(Object.create(null))
          // 仅暴露无副作用内建
          Object.assign(sandbox, {
            Math,
            Number,
            String,
            Boolean,
            Array,
            Object,
            JSON,
            Date,
            parseInt,
            parseFloat,
            isFinite,
            isNaN,
          })
          const wrapped = `"use strict";\n${code}`
          const script = new Script(wrapped, { filename: 'js_eval' })
          const result = script.runInContext(sandbox, { timeout: Math.min(timeoutMs, 2000) })
          if (result === undefined) return 'undefined'
          if (typeof result === 'string') return result
          try {
            return JSON.stringify(result)
          } catch {
            return String(result)
          }
        },
      }),
    )
  }

  if (options.ids.has('wolfram_alpha') && options.secrets?.wolframAppId) {
    try {
      const { WolframAlphaTool } = await import('@langchain/community/tools/wolframalpha')
      out.push(
        wrapToolGuards(
          new WolframAlphaTool({ appid: options.secrets.wolframAppId }),
          guards,
        ),
      )
    } catch (err) {
      console.warn('[chatvein/tools] wolfram_alpha unavailable:', err)
    }
  }

  return out
}
