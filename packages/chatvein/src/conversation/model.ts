/**
 * 模型调用薄封装（供 direct lane 与后续 worker 复用）。
 *
 * 只做「消息进、AIMessage 出」，**不实现任何循环** —— 循环交给 LangGraph / createAgent。
 */
import {
  AIMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from '@langchain/core/messages'
import type { LanguageModelLike } from '@langchain/core/language_models/base'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { contentToString } from '../shared'

/** 在系统提示缺失时注入 persona；已有 system 则不重复注入 */
export function withSystemPrompt(
  messages: BaseMessage[],
  systemPrompt?: string,
): BaseMessage[] {
  const prompt = systemPrompt?.trim()
  if (!prompt) return [...messages]
  const hasSystem = messages.some((m) => m?.getType?.() === 'system')
  if (hasSystem) return [...messages]
  return [new SystemMessage(prompt), ...messages]
}

/** 模型支持 bindTools 才绑定；不支持则原样返回（退化为无工具单次调用） */
export function bindToolsIfSupported(
  model: LanguageModelLike,
  tools: StructuredToolInterface[],
): LanguageModelLike {
  if (!tools.length) return model
  const bindable = model as { bindTools?: (t: StructuredToolInterface[]) => unknown }
  if (typeof bindable.bindTools !== 'function') return model
  return bindable.bindTools(tools) as LanguageModelLike
}

interface InvokeLike {
  invoke(input: unknown, options?: { signal?: AbortSignal }): Promise<unknown>
}

/** 归一化模型输出为 AIMessage（保留 tool_calls） */
export function toAIMessage(raw: unknown): AIMessage {
  if (AIMessage.isInstance(raw)) return raw
  if (raw && typeof raw === 'object' && 'content' in raw) {
    const r = raw as {
      content: unknown
      tool_calls?: AIMessage['tool_calls']
      id?: string
    }
    return new AIMessage({
      content: contentToString(r.content),
      ...(r.tool_calls?.length ? { tool_calls: r.tool_calls } : {}),
      ...(r.id ? { id: r.id } : {}),
    })
  }
  return new AIMessage(contentToString(raw))
}

/** 单次模型调用 */
export async function invokeModel(
  model: LanguageModelLike,
  messages: BaseMessage[],
  signal?: AbortSignal,
): Promise<AIMessage> {
  const raw = await (model as unknown as InvokeLike).invoke(
    messages,
    signal ? { signal } : undefined,
  )
  return toAIMessage(raw)
}

/** 工具返回值 → ToolMessage 文本 */
export function stringifyToolResult(result: unknown): string {
  if (result == null) return ''
  if (typeof result === 'string') return result
  if (typeof result === 'object') {
    try {
      return JSON.stringify(result)
    } catch {
      /* ignore */
    }
  }
  return String(result)
}

type ToolCall = NonNullable<AIMessage['tool_calls']>[number]

/** 执行单次 tool_call 并归一化为 ToolMessage（供 one_shot 等单步场景复用） */
export async function invokeToolCall(
  tool: StructuredToolInterface,
  call: ToolCall,
): Promise<ToolMessage> {
  const callId = call.id ?? `call_${call.name}`
  try {
    const result = await tool.invoke({ ...call, id: callId })
    return new ToolMessage({
      content: stringifyToolResult(result),
      tool_call_id: callId,
      name: call.name,
    })
  } catch (error) {
    return new ToolMessage({
      content: `工具执行失败：${error instanceof Error ? error.message : String(error)}`,
      tool_call_id: callId,
      name: call.name,
      status: 'error',
    })
  }
}
