/**
 * LangChain 消息转换辅助（跨 agent 单一来源）。
 */
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from '@langchain/core/messages'
import type { ChatMessage } from './types'

/**
 * 把「可选历史 + 本轮用户消息」转成 LangChain 消息序列。
 * persona / system 由各工厂自行注入，不在此重复。
 */
export function toLangChainMessages(opts: {
  history?: ReadonlyArray<ChatMessage>
  input: string
}): BaseMessage[] {
  const out: BaseMessage[] = []
  for (const m of opts.history ?? []) {
    if (m.role === 'system') out.push(new SystemMessage(m.content))
    else if (m.role === 'assistant') out.push(new AIMessage(m.content))
    else out.push(new HumanMessage(m.content))
  }
  out.push(new HumanMessage(opts.input))
  return out
}

/**
 * LangChain 消息 content 可能是 string 或 content-part 数组，统一成字符串。
 */
export function contentToString(content: unknown): string {
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

/** 从后往前取最后一条非空 human 消息文本（Router 输入 / 默认 query 等） */
export function lastHumanMessageText(messages: ReadonlyArray<BaseMessage>): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m?.getType?.() !== 'human') continue
    const text = contentToString(m.content).trim()
    if (text) return text
  }
  return ''
}

/**
 * LangChain 消息 → 纯文本 `ChatMessage`。
 * 多模态 content / 工具消息一律折成文本（历史只用于消解指代，够用即可）。
 */
export function toChatMessages(
  messages: ReadonlyArray<BaseMessage>,
): ChatMessage[] {
  const out: ChatMessage[] = []
  for (const m of messages) {
    const text = contentToString(m?.content).trim()
    if (!text) continue
    const type = m?.getType?.()
    if (type === 'system') out.push({ role: 'system', content: text })
    else if (type === 'ai') out.push({ role: 'assistant', content: text })
    else if (type === 'human') out.push({ role: 'user', content: text })
  }
  return out
}

/**
 * 最后一条 human 消息**之前**的历史（不含本轮），供 router / worker 消解指代。
 */
export function historyBeforeLastHuman(
  messages: ReadonlyArray<BaseMessage>,
): ChatMessage[] {
  if (!messages?.length) return []
  let lastHuman = -1
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.getType?.() === 'human') {
      lastHuman = i
      break
    }
  }
  const prior = lastHuman >= 0 ? messages.slice(0, lastHuman) : messages
  return toChatMessages(prior)
}

/** 从后往前找最后一条不带 tool_calls 的 AIMessage，取其文本 */
export function extractFinalAssistantText(messages: ReadonlyArray<BaseMessage>): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (!AIMessage.isInstance(m)) continue
    if (m.tool_calls && m.tool_calls.length > 0) continue
    const text = contentToString(m.content).trim()
    if (text) return text
  }
  return ''
}
