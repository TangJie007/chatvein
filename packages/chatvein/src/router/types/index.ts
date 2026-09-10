/**
 * Router 共享类型（权威源）。
 * conversation / budget / l0–l3 从此处引用，禁止反向依赖 conversation。
 */

/** 执行形态：决定母图复杂度 */
export type Lane = 'direct' | 'agentic' | 'orchestrated'

/** 领域：选哪个 worker（general 通用 / code 编码）。办公文档归 general。 */
export type Domain = 'general' | 'code' | (string & {})

/** 预算档 */
export type Band = 'trivial' | 'simple' | 'standard' | 'complex'

/** 模型档 */
export type ModelTier = 'weak' | 'medium' | 'strong'

/**
 * 工具权限。
 * readonly = 只读无副作用（桌面端对话档最实用）。
 */
export type ToolsPolicy = 'none' | 'readonly' | 'full'

/** @deprecated 使用 ModelTier */
export type ModelStrength = ModelTier

export type SafetyVerdict = 'allow' | 'reject' | 'review'
export type SafetyCategory = 'injection' | 'privilege' | 'exfiltration' | 'destructive'

export interface SafetyResult {
  verdict: SafetyVerdict
  category?: SafetyCategory
  ruleId?: string
  reason?: string
}

export interface SafetyRule {
  id: string
  category: SafetyCategory
  /** reject = 终止；flag = 抬档走审批 */
  action: 'reject' | 'flag'
  pattern: RegExp
  reason: string
}
