import { tool } from '@langchain/core/tools'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { z } from 'zod'

/**
 * 用 zod schema 定义一个 LangChain 工具，供 `createReactChatAgent` 绑定。
 * 正式工具集落地后由 `@chatvein/tools` 产出同构实例。
 */
export function defineAgentTool<T extends z.ZodType>(options: {
  name: string
  description: string
  schema: T
  invoke: (input: z.infer<T>) => Promise<string> | string
}): StructuredToolInterface {
  return tool(async (input) => options.invoke(input as z.infer<T>), {
    name: options.name,
    description: options.description,
    schema: options.schema,
  })
}
