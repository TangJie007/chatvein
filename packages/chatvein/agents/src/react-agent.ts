import type { BaseMessage } from '@langchain/core/messages'
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages'
import type { LanguageModelLike } from '@langchain/core/language_models/base'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { TokenUsage } from '@chatvein/common'
import { addTokenUsage, emptyTokenUsage } from '@chatvein/common'
import { createAgent } from 'langchain'

/** 单轮对话输入（最简 ReAct） */
export interface ReactChatInput {
  /** 用户本轮消息 */
  message: string
  /** 可选历史（不含本轮） */
  history?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
  /** LangGraph 递归上限（一轮模型调用或工具调用计 1）；默认 25 */
  recursionLimit?: number
}

export interface ReactChatResult {
  /** 最终助手文本（最后一条无 tool_calls 的 AIMessage） */
  content: string
  /** 完整消息轨迹（含 ToolMessage） */
  messages: BaseMessage[]
  /** 轨迹内各次模型调用的 token 合计（供应商不回传时为 0） */
  usage: TokenUsage
}

export interface CreateReactChatAgentOptions {
  /**
   * 须支持 OpenAI 风格 tool calling（ChatOpenAI / 测试用 ScriptedChatModel 等）。
   * 映射为 LangChain `createAgent` 的 `model`。
   */
  model?: LanguageModelLike
  /** @deprecated 使用 `model` */
  llm?: LanguageModelLike
  /** 工具列表；空数组 = 纯问答（仍走 ReAct 图，模型不调工具即结束） */
  tools?: StructuredToolInterface[]
  /** 系统提示（persona）；映射为 createAgent 的 systemPrompt */
  systemPrompt?: string
  /** Agent 名（trace / 多 Agent 区分） */
  name?: string
}

/**
 * 最简 ReAct：封装 LangChain `createAgent`（LangGraph 上跑），不自研 while 循环。
 * 替代已弃用的 `@langchain/langgraph/prebuilt` `createReactAgent`。
 */
export function createReactChatAgent(options: CreateReactChatAgentOptions) {
  const model = options.model ?? options.llm
  if (!model) {
    throw new Error('createReactChatAgent: model（或 llm）必填')
  }
  return createAgent({
    model,
    tools: options.tools ?? [],
    systemPrompt: options.systemPrompt,
    name: options.name,
  })
}

export type ReactChatAgent = ReturnType<typeof createReactChatAgent>

/**
 * 同步 invoke 一轮用户消息，返回最终回答与消息轨迹。
 */
export async function invokeReactChatAgent(
  agent: ReactChatAgent,
  input: ReactChatInput,
): Promise<ReactChatResult> {
  const messages = toLangChainMessages(input)
  const state = await agent.invoke(
    { messages },
    { recursionLimit: input.recursionLimit ?? 25 },
  )
  return {
    content: extractFinalAssistantText(state.messages),
    messages: state.messages,
    usage: aggregateTokenUsage(state.messages),
  }
}

function toLangChainMessages(input: ReactChatInput): BaseMessage[] {
  const out: BaseMessage[] = []
  for (const m of input.history ?? []) {
    if (m.role === 'system') out.push(new SystemMessage(m.content))
    else if (m.role === 'assistant') out.push(new AIMessage(m.content))
    else out.push(new HumanMessage(m.content))
  }
  out.push(new HumanMessage(input.message))
  return out
}

/** 从后往前找最后一条纯文本 AIMessage */
export function extractFinalAssistantText(messages: BaseMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (!AIMessage.isInstance(m)) continue
    const calls = m.tool_calls
    if (calls && calls.length > 0) continue
    const text = messageContentToString(m.content).trim()
    if (text) return text
  }
  return ''
}

/** 汇总轨迹中 AIMessage 的 usage_metadata / response_metadata */
export function aggregateTokenUsage(messages: BaseMessage[]): TokenUsage {
  let total = emptyTokenUsage()
  for (const m of messages) {
    const one = tokenUsageFromMessage(m)
    if (one) total = addTokenUsage(total, one)
  }
  return total
}

export function tokenUsageFromMessage(message: BaseMessage): TokenUsage | null {
  if (!AIMessage.isInstance(message)) return null
  const meta = message.usage_metadata
  if (meta) {
    const promptTokens = Number(meta.input_tokens) || 0
    const completionTokens = Number(meta.output_tokens) || 0
    const totalTokens = Number(meta.total_tokens) || promptTokens + completionTokens
    if (promptTokens || completionTokens || totalTokens) {
      return { promptTokens, completionTokens, totalTokens }
    }
  }
  const rm = message.response_metadata as
    | {
        tokenUsage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
      }
    | undefined
  if (rm?.tokenUsage) {
    const promptTokens = Number(rm.tokenUsage.promptTokens) || 0
    const completionTokens = Number(rm.tokenUsage.completionTokens) || 0
    const totalTokens = Number(rm.tokenUsage.totalTokens) || promptTokens + completionTokens
    if (promptTokens || completionTokens || totalTokens) {
      return { promptTokens, completionTokens, totalTokens }
    }
  }
  if (rm?.usage) {
    const promptTokens = Number(rm.usage.prompt_tokens) || 0
    const completionTokens = Number(rm.usage.completion_tokens) || 0
    const totalTokens = Number(rm.usage.total_tokens) || promptTokens + completionTokens
    if (promptTokens || completionTokens || totalTokens) {
      return { promptTokens, completionTokens, totalTokens }
    }
  }
  return null
}

function messageContentToString(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object' && 'text' in part) {
          return String((part as { text: unknown }).text ?? '')
        }
        return ''
      })
      .join('')
  }
  return content == null ? '' : String(content)
}
