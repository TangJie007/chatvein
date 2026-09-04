/**
 * L2 弱模结构化输出契约。
 * 窄枚举、可执行字段；与 RouteDecision 对齐，但不输出 unknown（必须拍板）。
 */
import { z } from 'zod'

/** L2 判定：复杂度 + 执行策略补丁（禁止再吐 unknown） */
export const L2JudgementSchema = z.object({
  /** 必须落到具体档，禁止 unknown */
  band: z.enum(['trivial', 'simple', 'standard', 'complex']),
  /** 工具必须拍板：none | full（消化 L1 的 unknown） */
  tools: z.enum(['none', 'full']),
  modelTier: z.enum(['weak', 'medium', 'strong']).optional(),
  maxSteps: z.number().int().min(0).max(32).optional(),
  memoryRecall: z.boolean().optional(),
  allowSubAgents: z.boolean().optional(),
  hintUserCreateGroup: z.boolean().optional(),
  hintUserForge: z.boolean().optional(),
  /** false → 下游仍可偏保守，但 tools/band 已按本结果应用 */
  confident: z.boolean(),
  /** 短理由，仅日志 / reasons，不驱动执行 */
  reason: z.string().max(200).optional(),
})

export type L2Judgement = z.infer<typeof L2JudgementSchema>

/** 从模型原文里抠 JSON 对象（允许前后废话） */
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
