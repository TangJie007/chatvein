import type { StructuredToolInterface } from '@langchain/core/tools'
import { DynamicTool, tool } from '@langchain/core/tools'
import { z } from 'zod'
import { truncateOutput, withTimeout } from './guards'

type AnyTool = StructuredToolInterface

/** 给 community 经典 `Tool`（字符串入参）包超时 + 截断 */
export function wrapToolGuards(
  base: AnyTool,
  options: { timeoutMs: number; maxOutputChars: number },
): AnyTool {
  return new DynamicTool({
    name: base.name,
    description: base.description,
    func: async (input: string) => {
      const raw = await withTimeout(
        Promise.resolve(base.invoke(input)),
        options.timeoutMs,
        base.name,
      )
      const text = typeof raw === 'string' ? raw : JSON.stringify(raw)
      return truncateOutput(text, options.maxOutputChars)
    },
  })
}

export function defineBuiltinTool<T extends z.ZodType>(options: {
  name: string
  description: string
  schema: T
  timeoutMs: number
  maxOutputChars: number
  invoke: (input: z.infer<T>) => Promise<string> | string
}): AnyTool {
  return tool(
    async (input) => {
      const raw = await withTimeout(
        Promise.resolve(options.invoke(input as z.infer<T>)),
        options.timeoutMs,
        options.name,
      )
      return truncateOutput(raw, options.maxOutputChars)
    },
    {
      name: options.name,
      description: options.description,
      schema: options.schema,
    },
  )
}

/**
 * 给已有工具（如 MCP 工具）做轻量输出折叠：用 Proxy 仅拦截 `invoke`，
 * 对返回结果截断，完整透传原工具的 name / description / schema 等元信息，
 * 不影响参数解析与 tool calling。用于让未内置截断的 MCP 工具也走统一折叠策略。
 */
export function wrapToolOutput(inner: AnyTool, maxChars: number): AnyTool {
  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === 'invoke') {
        return async (input: unknown, options?: unknown) => {
          const raw = await Reflect.apply(
            target.invoke as (...args: unknown[]) => Promise<unknown>,
            target,
            [input, options],
          )
          const text = typeof raw === 'string' ? raw : JSON.stringify(raw)
          return truncateOutput(text, maxChars)
        }
      }
      return Reflect.get(target, prop, receiver)
    },
  }) as unknown as AnyTool
}
