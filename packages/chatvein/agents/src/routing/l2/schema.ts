/**
 * L2 弱模结构化输出契约。
 * 窄枚举、可执行字段；禁止 unknown；含面向工具路由的改写。
 */
import { z } from 'zod'

export const L2JudgementSchema = z.object({
  band: z.enum(['trivial', 'simple', 'standard', 'complex']),
  tools: z.enum(['none', 'full']),
  modelTier: z.enum(['weak', 'medium', 'strong']).optional(),
  maxSteps: z.number().int().min(0).max(64).optional(),
  memoryRecall: z.boolean().optional(),
  allowSubAgents: z.boolean().optional(),
  hintUserCreateGroup: z.boolean().optional(),
  hintUserForge: z.boolean().optional(),
  confident: z.boolean(),
  reason: z.string().max(200).optional(),
  /**
   * 面向工具选用 / 向量检索的语义描述（中文为主）。
   * 不是给用户看的回复；应展开隐含动作与对象（读文件、搜索、计算等）。
   */
  rewrittenQuery: z.string().min(1).max(400),
})

export type L2Judgement = z.infer<typeof L2JudgementSchema>

export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1)) as unknown
    }
    throw new Error('l2_no_json_object')
  }
}

export function parseL2Judgement(raw: unknown): L2Judgement {
  return L2JudgementSchema.parse(raw)
}
