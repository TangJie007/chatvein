/**
 * 工具 token 成本估算（C3 预算裁剪用）。
 *
 * 关键：工具真正发给模型的开销不只是 `name: description` 文本，**参数 JSON Schema
 * 往往更占 token**（嵌套对象、枚举、description、required 列表）。这里把工具按
 * OpenAI function-calling 的实际形态序列化后再估算，量级与真实请求一致。
 *
 * 不引入外部 tokenizer，复用 `@chatvein/context` 的启发式估算（CJK/ASCII 分口径），
 * 只用于预算护栏，不用于计费。
 */
import { z } from 'zod'
import { estimateTextTokens } from '@chatvein/context'
import type { StructuredToolInterface } from './types'

/** 单个工具在请求里的结构性开销（type/function 包裹、字段名、分隔符） */
const TOOL_STRUCTURE_OVERHEAD = 8

/** 估算工具参数 schema 的 token 数（zod → JSON Schema 序列化） */
export function estimateToolSchemaTokens(schema: unknown): number {
  if (!schema) return 0
  const json = toolSchemaToJson(schema)
  if (!json) return 0
  // 紧凑序列化：键名、类型、枚举、嵌套结构都计入
  return estimateTextTokens(safeStableStringify(json))
}

/**
 * 估算单个工具的总 token 成本 = 名称 + 描述 + 完整参数 JSON Schema + 结构开销。
 * 这是工具绑定进请求后实际占用的量级。
 */
export function estimateToolTokens(tool: {
  name: string
  description?: string
  schema?: unknown
}): number {
  const head = `${tool.name}: ${tool.description ?? ''}`
  return (
    estimateTextTokens(head) + estimateToolSchemaTokens(tool.schema) + TOOL_STRUCTURE_OVERHEAD
  )
}

/** 批量：返回每个工具的成本（与入参同序） */
export function estimateToolsTokens(
  tools: ReadonlyArray<{ name: string; description?: string; schema?: unknown }>,
): number[] {
  return tools.map((t) => estimateToolTokens(t))
}

/**
 * 把工具的 zod schema 转成「发给模型的 JSON Schema」。
 * zod v4 用 `z.toJSONSchema`；失败 / 非 zod 时回退到可枚举的 shape，再不行返回 null。
 */
function toolSchemaToJson(schema: unknown): unknown {
  try {
    return z.toJSONSchema(schema as z.ZodType)
  } catch {
    // 落到 shape 兜底（部分动态工具直接挂了对象形态）
  }
  const shape = (schema as { shape?: Record<string, unknown> } | null)?.shape
  if (shape && typeof shape === 'object') {
    return {
      type: 'object',
      properties: Object.fromEntries(
        Object.keys(shape).map((k) => [k, { type: 'string' }]),
      ),
    }
  }
  return null
}

/** 稳定序列化（键排序），避免同结构因键序不同导致估算抖动 */
function safeStableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    )
  }
  return value
}

/** 类型守卫：StructuredToolInterface 带 zod schema */
export function toolWithSchema(tool: StructuredToolInterface): StructuredToolInterface & {
  schema?: unknown
} {
  return tool as StructuredToolInterface & { schema?: unknown }
}
