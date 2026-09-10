/**
 * L3 输出契约：直接复用 L2 的宽松 zod schema 与枚举归一。
 */
import { L2RawSchema, parseL2Judgement } from '../l2/schema'
import type { L3Judgement } from './types'

export const L3RawSchema = L2RawSchema

export function parseL3Judgement(raw: unknown): L3Judgement {
  return parseL2Judgement(raw, 'l3')
}
