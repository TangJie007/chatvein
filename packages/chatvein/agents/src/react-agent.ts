import type { BaseMessage } from '@langchain/core/messages'
import { AIMessage, AIMessageChunk, HumanMessage, SystemMessage } from '@langchain/core/messages'
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
  /** 可选：LangGraph 线程 id；传了即走有状态调用（checkpointer 接管跨轮存储） */
  threadId?: string
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
  model: LanguageModelLike
  /** 工具列表；空数组 = 纯问答（仍走 ReAct 图，模型不调工具即结束） */
  tools?: StructuredToolInterface[]
  /** 系统提示（persona）；映射为 createAgent 的 systemPrompt */
  systemPrompt?: string
  /** Agent 名（trace / 多 Agent 区分） */
  name?: string
  /**
   * 可选 LangGraph checkpointer：启用后跨轮消息轨迹由它持久化（有状态调用）。
   * 当前 ChatService.send 走无状态范式（每次传完整 history），故默认不传；
   * 若改为只传本轮增量 + threadId，即可让 checkpointer 接管「存储」层。
   * 注意：它与本模块的短期记忆摘要态（short-term.store.ts）是不同层，互不替代。
   */
  checkpointer?: unknown
}

/**
 * 最简 ReAct：封装 LangChain `createAgent`（LangGraph 上跑），不自研 while 循环。
 * 替代已弃用的 `@langchain/langgraph/prebuilt` `createReactAgent`。
 */
export function createReactChatAgent(options: CreateReactChatAgentOptions) {
  return createAgent({
    model: options.model,
    tools: options.tools ?? [],
    systemPrompt: options.systemPrompt,
    name: options.name,
    ...(options.checkpointer ? { checkpointer: options.checkpointer as never } : {}),
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
  const config = {
    recursionLimit: input.recursionLimit ?? 25,
    ...(input.threadId ? { configurable: { thread_id: input.threadId } } : {}),
  }
  const state = await agent.invoke({ messages }, config)
  return {
    content: extractFinalAssistantText(state.messages),
    messages: state.messages,
    usage: aggregateTokenUsage(state.messages),
  }
}

/** 流式回调：reasoning 逐字、工具调用开始、工具返回、正文逐字 */
export interface ReactStreamHandlers {
  /** 模型「思考」增量（DeepSeek-R1 / Qwen 等的 reasoning_content；不支持推理的模型不触发） */
  onReasoning?: (delta: string) => void
  /** 一次工具调用开始（拿到工具名即触发；args 为已累积的原始参数字符串） */
  onToolCallStart?: (info: { name: string; args: string }) => void
  /** 正文 token 增量（最终回答的流式文本；可选，用于打字机正文） */
  onAnswerDelta?: (delta: string) => void
}

/**
 * 流式版 invoke：跑同一个 ReAct 图，但用 `agent.stream` 边跑边回调。
 *
 * - streamMode `messages`：逐 `AIMessageChunk` 透出 reasoning / 工具调用 / 正文增量；
 * - streamMode `values`：每步给出完整 state，最后一次即终态，用于提取 content / messages / usage。
 *
 * reasoning 位于 `additional_kwargs.reasoning_content`（部分网关为 `reasoning`）。
 * 工具调用块在 chunk 上以 `tool_call_chunks` 增量到达，按 index 聚合出工具名。
 */
export async function streamReactChatAgent(
  agent: ReactChatAgent,
  input: ReactChatInput,
  handlers: ReactStreamHandlers = {},
): Promise<ReactChatResult> {
  const messages = toLangChainMessages(input)
  const config = {
    recursionLimit: input.recursionLimit ?? 25,
    ...(input.threadId ? { configurable: { thread_id: input.threadId } } : {}),
  }

  /** 已开始回调过的工具调用，按 index 去重（同一工具调用跨多个 chunk） */
  const announcedToolCalls = new Set<number>()
  let finalMessages: BaseMessage[] | null = null

  const stream = (await agent.stream(
    { messages },
    { ...config, streamMode: ['messages', 'values'] },
  )) as AsyncIterable<[mode: string, payload: unknown]>

  for await (const [mode, payload] of stream) {
    if (mode === 'messages') {
      const [chunk] = payload as [AIMessageChunk, unknown]
      if (!AIMessageChunk.isInstance(chunk)) continue

      const reasoning = extractReasoningDelta(chunk)
      if (reasoning) handlers.onReasoning?.(reasoning)

      // 工具调用：按 chunk 上的 tool_call_chunks 聚合，第一次拿到名字即回调一次
      const toolChunks = (chunk as unknown as { tool_call_chunks?: Array<{
        index?: number
        name?: string
        args?: string
      }> }).tool_call_chunks
      if (toolChunks && toolChunks.length) {
        for (const tc of toolChunks) {
          const idx = tc.index ?? 0
          const name = tc.name
          if (name && !announcedToolCalls.has(idx)) {
            announcedToolCalls.add(idx)
            handlers.onToolCallStart?.({ name, args: tc.args ?? '' })
          }
        }
      }

      // 正文增量：仅当该 chunk 没有携带工具调用时，才是面向用户的回答文本
      const hasToolCall =
        (toolChunks && toolChunks.length > 0) ||
        (chunk.tool_calls && chunk.tool_calls.length > 0)
      if (!hasToolCall && typeof chunk.content === 'string' && chunk.content) {
        handlers.onAnswerDelta?.(chunk.content)
      }
    } else if (mode === 'values') {
      const state = payload as { messages?: BaseMessage[] }
      if (state && Array.isArray(state.messages)) finalMessages = state.messages
    }
  }

  const resultMessages = finalMessages ?? messages
  return {
    content: extractFinalAssistantText(resultMessages),
    messages: resultMessages,
    usage: aggregateTokenUsage(resultMessages),
  }
}

/** 从 AIMessageChunk 中取推理增量（reasoning_content / reasoning），无则空串 */
function extractReasoningDelta(chunk: AIMessageChunk): string {
  const kw = chunk.additional_kwargs as
    | { reasoning_content?: unknown; reasoning?: unknown }
    | undefined
  const rc = kw?.reasoning_content
  if (typeof rc === 'string' && rc) return rc
  if (Array.isArray(rc)) {
    return rc
      .map((p) => (typeof p === 'string' ? p : (p as { text?: unknown })?.text))
      .filter((x): x is string => typeof x === 'string')
      .join('')
  }
  if (typeof kw?.reasoning === 'string' && kw.reasoning) return kw.reasoning
  return ''
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
