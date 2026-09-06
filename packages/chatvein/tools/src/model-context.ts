/**
 * 按主模型上下文窗口动态计算「工具预算」（C3）。
 *
 * 旧实现把工具预算写死成 4000 token：小窗口模型（8k）会被工具挤占对话空间，
 * 大窗口模型（128k）又白白裁掉可用工具。这里：
 *   1. 由模型 id 推断上下文窗口（内置常见家族表 + 名称里的 `Nk` 后缀，未命中用保守默认）；
 *   2. 工具预算 = 窗口的一定比例，并扣除输出预留，再 clamp 到合理区间。
 *
 * 纯函数、零网络依赖；模型表未命中时走保守默认，宁可少绑工具也不爆上下文。
 */

/** 未识别模型时的保守上下文窗口（token） */
export const DEFAULT_CONTEXT_WINDOW = 8_000

/** 工具预算占上下文窗口的比例（其余留给 system prompt / 历史 / 本轮输入 / 输出） */
const TOOL_BUDGET_RATIO = 0.15

/** 工具预算下限：保证至少能绑几个常用工具 */
const MIN_TOOL_BUDGET = 1_500
/** 工具预算上限：工具再多也不该吃掉超过这么多窗口 */
const MAX_TOOL_BUDGET = 16_000

/** 输出预留（回答 + 工具调用）的下限，窗口越小越要留足 */
const MIN_OUTPUT_RESERVE = 2_000

/**
 * 常见模型家族的上下文窗口。按「名称包含关键字」匹配（小写），先命中先得。
 * 数值取各家族较常见的档位；同名有多个档位时取偏保守值，避免高估导致爆上下文。
 */
const CONTEXT_WINDOW_HINTS: ReadonlyArray<readonly [string, number]> = [
  // —— 显式大窗口家族 ——
  ['1m', 1_000_000],
  ['gemini-2', 1_000_000],
  ['gemini-1.5', 1_000_000],
  ['claude-3-5', 200_000],
  ['claude-3-7', 200_000],
  ['claude-3', 200_000],
  ['gpt-4.1', 1_000_000],
  ['gpt-4o', 128_000],
  ['gpt-4-turbo', 128_000],
  ['gpt-4', 8_192],
  ['gpt-3.5', 16_384],
  ['o3', 200_000],
  ['o4', 200_000],
  ['deepseek-reasoner', 64_000],
  ['deepseek', 64_000],
  ['qwen-max', 32_000],
  ['qwen-plus', 131_072],
  ['qwen-turbo', 1_000_000],
  ['qwen', 32_000],
  ['moonshot-v1-128k', 128_000],
  ['moonshot-v1-32k', 32_000],
  ['moonshot-v1-8k', 8_000],
  ['moonshot', 32_000],
  ['glm-4', 128_000],
  ['llama-3', 128_000],
]

/**
 * 推断模型的上下文窗口（token）。
 * @param modelId 网关侧模型 id（如 `gpt-4o-mini`、`moonshot-v1-128k`）
 */
export function inferContextWindow(modelId: string | undefined | null): number {
  const id = (modelId ?? '').toLowerCase().trim()
  if (!id) return DEFAULT_CONTEXT_WINDOW

  for (const [hint, tokens] of CONTEXT_WINDOW_HINTS) {
    if (id.includes(hint)) return tokens
  }

  // 名称里的 `Nk` / `Nctx` 后缀：moonshot-v1-128k、xxx-32k、xxx-200k
  const kMatch = id.match(/(\d{2,3})\s*k\b/)
  if (kMatch) {
    const n = Number(kMatch[1])
    if (Number.isFinite(n) && n >= 4) return n * 1_000
  }

  return DEFAULT_CONTEXT_WINDOW
}

export interface ToolBudgetOptions {
  /** 主模型上下文窗口（token）；不传则由 modelId 推断 */
  contextWindow?: number
  /** 主模型网关 id，用于推断窗口 */
  modelId?: string
  /**
   * 输出预留 token（回答 + 工具调用结果回流）。
   * 不传则取窗口的 25% 与 `MIN_OUTPUT_RESERVE` 的较大值。
   */
  outputReserve?: number
}

/**
 * 计算工具预算（token）：窗口的 `TOOL_BUDGET_RATIO`，扣除输出预留后 clamp。
 *
 * 说明：历史/短期记忆窗口由 memory 层独立裁剪，这里只负责「工具这块最多吃多少」，
 * 取一个保守比例，保证小窗口不被工具挤爆、大窗口能多绑工具。
 */
export function computeToolBudgetTokens(options: ToolBudgetOptions = {}): number {
  const window =
    options.contextWindow && options.contextWindow > 0
      ? options.contextWindow
      : inferContextWindow(options.modelId)

  const outputReserve = Math.max(
    MIN_OUTPUT_RESERVE,
    options.outputReserve ?? Math.floor(window * 0.25),
  )

  // 工具可用 = 窗口比例，但不能吃掉「窗口 - 输出预留」之后的全部
  const proportional = Math.floor(window * TOOL_BUDGET_RATIO)
  const headroom = window - outputReserve
  const budget = Math.min(proportional, Math.max(0, headroom))

  return Math.min(MAX_TOOL_BUDGET, Math.max(MIN_TOOL_BUDGET, budget))
}
