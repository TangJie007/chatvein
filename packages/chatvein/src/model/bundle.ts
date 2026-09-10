/**
 * 模型档位派生：一份配置 → main / fast / strong 三档（+ filter 复用 fast）。
 *
 * 内置该派生的原因：路由 L2/L3 与工具筛选都需要「弱模 / 强模」，
 * 但调用方通常只有一份模型配置（或干脆只有一个已建好的模型实例）。
 * 由包内按档位派生后，调用方不必再手工建 3~4 个模型再逐个注入。
 */
import type { LanguageModelLike } from '@langchain/core/language_models/base'
import {
  createChatModel,
  type ChatModelConfig,
  type CreateChatModelOptions,
} from './create-chat-model'

/** 档位语义 */
export type ModelTier = 'main' | 'fast' | 'strong'

/** 一份配置描述全部档位：`fast` / `strong` 省略时继承主配置 */
export interface ChatveinModelConfig extends ChatModelConfig {
  /** L2 判定与工具筛选用的弱模；字符串 = 只覆盖模型名，其余继承主配置 */
  fast?: string | ChatModelConfig
  /** L3 升级判定用的强模；省略 = 同 `fast` → 同主配置 */
  strong?: string | ChatModelConfig
  /** 建模通用选项（streaming / callbacks），三档共用 */
  options?: CreateChatModelOptions
}

/** 派生结果：`filter` 与 `fast` 同一实例（都是弱模语义） */
export interface ModelBundle {
  /** 母图与 worker 的主执行模型 */
  main: LanguageModelLike
  /** 路由 L2 */
  fast: LanguageModelLike
  /** 路由 L3 升级 */
  strong: LanguageModelLike
  /** 工具筛选 */
  filter: LanguageModelLike
}

function merge(
  base: ChatModelConfig,
  override?: string | ChatModelConfig,
): ChatModelConfig {
  if (!override) return base
  if (typeof override === 'string') {
    return { ...base, model: override }
  }
  const merged = { ...base, ...override }
  // `fast` / `strong` 是档位描述，不是建模参数，避免被逐层继承
  delete (merged as Partial<ChatveinModelConfig>).fast
  delete (merged as Partial<ChatveinModelConfig>).strong
  delete (merged as Partial<ChatveinModelConfig>).options
  return merged
}

function isModelLike(value: unknown): value is LanguageModelLike {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    typeof (value as { invoke?: unknown }).invoke === 'function'
  )
}

/**
 * 归一化为模型档位束。
 *
 * - 传模型实例 → 四档共用（本地单模型 / 测试场景）。
 * - 传配置 → main 用主配置，`fast` / `strong` 缺省时继承主配置。
 */
export function resolveModelBundle(
  input: ChatveinModelConfig | LanguageModelLike,
): ModelBundle {
  if (isModelLike(input)) {
    return { main: input, fast: input, strong: input, filter: input }
  }
  if (!input || typeof input !== 'object' || !String(input.model ?? '').trim()) {
    throw new Error('resolveModelBundle: model is required')
  }
  const buildOptions = input.options ?? {}
  const main = createChatModel(input, buildOptions)
  const fast = createChatModel(merge(input, input.fast), buildOptions)
  // 未单独指定强模时复用弱模实例（单模型部署下 L3 与 L2 同模，仍可正常收口）
  const strong = input.strong
    ? createChatModel(merge(input, input.strong), buildOptions)
    : fast
  return { main, fast, strong, filter: fast }
}
