import type { StructuredToolInterface } from '@langchain/core/tools'
import { z } from 'zod'

/** 调试用：把绑定工具展开为 name / description / JSON Schema */
export function summarizeToolsForDebug(tools: StructuredToolInterface[]): Array<{
  name: string
  description: string
  parameters?: unknown
}> {
  return tools.map((t) => {
    const schema = (t as unknown as { schema?: z.ZodType }).schema
    let parameters: unknown
    if (schema) {
      try {
        parameters = z.toJSONSchema(schema)
      } catch {
        parameters = { note: 'schema_serialize_failed' }
      }
    }
    return {
      name: t.name,
      description: t.description,
      ...(parameters !== undefined ? { parameters } : {}),
    }
  })
}
