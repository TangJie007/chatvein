/**
 * 模型归一化：把「模型名 + 连接参数」或「已建好的实例」收敛成**单个**模型实例。
 *
 * 包内不再派生档位：路由 L2 / L3、每轮工具筛选、母图与 worker 全部复用同一个实例，
 * 调用方只需给一份模型配置。
 */
import type { LanguageModelLike } from '@langchain/core/language_models/base'
import { createChatModel, type ChatModelConfig } from './create-chat-model'

/** 连接参数（模型名由调用方单独给） */
export type ChatModelConnection = Omit<ChatModelConfig, 'model'>

function isModelLike(value: unknown): value is LanguageModelLike {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    typeof (value as { invoke?: unknown }).invoke === 'function'
  )
}

/**
 * 归一化为单个模型实例。
 *
 * - 传模型实例 → 原样返回（本地单模型 / 测试场景）。
 * - 传模型名 → 与 `connection`（apiKey / baseUrl / temperature / maxTokens）一起建实例。
 */
export function resolveChatModel(
  input: string | LanguageModelLike,
  connection: ChatModelConnection = {},
): LanguageModelLike {
  if (isModelLike(input)) return input
  const name = typeof input === 'string' ? input.trim() : ''
  if (!name) {
    throw new Error('resolveChatModel: model is required')
  }
  return createChatModel({ ...connection, model: name })
}
