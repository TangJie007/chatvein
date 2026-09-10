/**
 * OpenAI 兼容 Chat 模型工厂（包内唯一建造点）。
 *
 * 注意：这是**构造**参数，不是 `ChatOpenAICallOptions`（后者是 invoke 时的运行时选项）。
 */
import { ChatOpenAI } from '@langchain/openai'
import type { BaseCallbackHandler } from '@langchain/core/callbacks/base'

/** 创建 ChatOpenAI 所需的配置（OpenAI / DeepSeek / Ollama 等兼容网关） */
export interface ChatModelConfig {
  /** 模型名，如 gpt-4o-mini / deepseek-chat */
  model: string
  /** API Key；本地 Ollama 等可省略 */
  apiKey?: string
  /** OpenAI 兼容 base URL */
  baseUrl?: string
  temperature?: number
}

export interface CreateChatModelOptions {
  /** 关流式（**默认开启**）；开着才能拿到 thinking / token 增量回调 */
  streaming?: boolean
  callbacks?: BaseCallbackHandler[]
}

/**
 * 用配置构造 `ChatOpenAI`。
 * persona / 路由逻辑不在此；只做模型实例化。
 */
export function createChatModel(
  cfg: ChatModelConfig,
  options: CreateChatModelOptions = {},
): ChatOpenAI {
  if (!cfg?.model?.trim()) {
    throw new Error('createChatModel: cfg.model is required')
  }
  return new ChatOpenAI({
    model: cfg.model.trim(),
    apiKey: cfg.apiKey?.trim() || 'not-needed',
    ...(cfg.baseUrl?.trim()
      ? { configuration: { baseURL: cfg.baseUrl.trim() } }
      : {}),
    temperature: cfg.temperature ?? 0.7,
    ...(options.streaming === false ? {} : { streaming: true, streamUsage: true }),
    ...(options.callbacks?.length ? { callbacks: options.callbacks } : {}),
  })
}
