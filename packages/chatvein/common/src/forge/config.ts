/**
 * Harness 配置类型与 schema（`config/forge.config.ts`）。
 *
 * 对应 PRD §7 Config / F18：模型分级、并行度、预算、工具白名单、截断阈值。
 * 类型与 zod schema 都在 common，app 与 service 共享同一份校验。
 * API Key 不硬编码进配置文件：运行时从加密存储/环境注入，绝不写入 trace。
 */
import { z } from 'zod'
import { DEFAULT_BUDGET, type Budget, type ModelTier } from '../core/types'
import { ValidationError } from '../core/errors'

/** 单个模型端点（OpenAI 兼容）；apiKey 运行时注入，可留空 */
export interface ModelEndpointConfig {
  /** 端点显示 id（计量/降级留痕用） */
  id: string
  baseUrl: string
  /** 运行时注入（加密存储 / 环境变量）；配置文件里留空 */
  apiKey?: string
  model: string
  temperature?: number
  /** 0 / 省略 = 不传 max_tokens */
  maxTokens?: number
  /** 该端点最大并发（防 429），默认 1 */
  maxConcurrency?: number
}

/** exec_shell 命令白名单（PRD F6：npm/pnpm/node/git/lint/构建/测试） */
export const DEFAULT_EXEC_ALLOWLIST = [
  'npm',
  'npx',
  'pnpm',
  'node',
  'git',
  'yarn',
  'tsc',
  'eslint',
  'vitest',
  'jest',
  'pytest',
] as const

/** 工具输出截断阈值（进上下文前；PRD 5.3.4/5.3.5） */
export interface TruncationConfig {
  /** read_file 超过此行数截断 */
  maxFileLines: number
  /** exec 输出头部保留行数 */
  execHeadLines: number
  /** exec 输出尾部保留行数 */
  execTailLines: number
  /** grep 命中上限 */
  grepMaxMatches: number
  /** glob 命中上限 */
  globMaxMatches: number
}

export const DEFAULT_TRUNCATION: TruncationConfig = {
  maxFileLines: 800,
  execHeadLines: 200,
  execTailLines: 200,
  grepMaxMatches: 100,
  globMaxMatches: 200,
}

export interface ForgeConfig {
  /** 强/中/弱三档模型端点；每档可给多个（按序降级） */
  models: Record<ModelTier, ModelEndpointConfig[]>
  /** 预算护栏阈值 */
  budget: Budget
  /** 并行度；一期固定串行（1），P1 才开并发 */
  parallelism: number
  /** 运行产物根目录（runs/） */
  runsRoot: string
  /** 沙箱 provider；local 为 P0 默认，docker 为 P1 */
  sandbox: { provider: 'local' | 'docker' }
  /** 模型调用重试上限（降级链） */
  retry: { maxAttempts: number }
  /** 工具治理 */
  tools: {
    /** exec 允许的命令白名单 */
    execAllowlist: string[]
    /** 截断阈值 */
    truncation: TruncationConfig
  }
}

const endpointSchema = z.object({
  id: z.string().min(1),
  baseUrl: z.string().min(1),
  apiKey: z.string().optional(),
  model: z.string().min(1),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().nonnegative().optional(),
  maxConcurrency: z.number().int().positive().optional(),
})

export const forgeConfigSchema = z.object({
  models: z.object({
    strong: z.array(endpointSchema),
    medium: z.array(endpointSchema),
    weak: z.array(endpointSchema),
  }),
  budget: z
    .object({
      maxTokens: z.number().int().positive(),
      maxSteps: z.number().int().positive(),
      maxWallClockMs: z.number().int().positive(),
      maxConsecutiveFailures: z.number().int().positive(),
    })
    .default(() => ({ ...DEFAULT_BUDGET })),
  parallelism: z.number().int().positive().default(1),
  runsRoot: z.string().default('runs'),
  sandbox: z
    .object({ provider: z.enum(['local', 'docker']).default('local') })
    .default(() => ({ provider: 'local' as const })),
  retry: z
    .object({ maxAttempts: z.number().int().positive().default(3) })
    .default(() => ({ maxAttempts: 3 })),
  tools: z
    .object({
      execAllowlist: z.array(z.string()).default([...DEFAULT_EXEC_ALLOWLIST]),
      truncation: z
        .object({
          maxFileLines: z.number().int().positive().default(DEFAULT_TRUNCATION.maxFileLines),
          execHeadLines: z.number().int().positive().default(DEFAULT_TRUNCATION.execHeadLines),
          execTailLines: z.number().int().positive().default(DEFAULT_TRUNCATION.execTailLines),
          grepMaxMatches: z.number().int().positive().default(DEFAULT_TRUNCATION.grepMaxMatches),
          globMaxMatches: z.number().int().positive().default(DEFAULT_TRUNCATION.globMaxMatches),
        })
        .default(() => ({ ...DEFAULT_TRUNCATION })),
    })
    .default(() => ({
      execAllowlist: [...DEFAULT_EXEC_ALLOWLIST],
      truncation: { ...DEFAULT_TRUNCATION },
    })),
})

/**
 * 基线默认配置（models 留空，需用户填写或由 app 配置注入；密钥运行时注入）。
 * 供 `forge.config.ts` 展开覆盖，也可作为 parseForgeConfig 的对照。
 */
export const DEFAULT_FORGE_CONFIG: ForgeConfig = {
  models: { strong: [], medium: [], weak: [] },
  budget: DEFAULT_BUDGET,
  parallelism: 1,
  runsRoot: 'runs',
  sandbox: { provider: 'local' },
  retry: { maxAttempts: 3 },
  tools: {
    execAllowlist: [...DEFAULT_EXEC_ALLOWLIST],
    truncation: { ...DEFAULT_TRUNCATION },
  },
}

/** 校验并补全配置；失败抛 ValidationError（含字段级信息） */
export function parseForgeConfig(raw: unknown): ForgeConfig {
  const result = forgeConfigSchema.safeParse(raw)
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ')
    throw new ValidationError(`forge.config 校验失败：${issues}`)
  }
  return result.data as ForgeConfig
}
