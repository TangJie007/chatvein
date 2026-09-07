import { Inject, Injectable } from '@electrum/common'
import {
  buildSummarizePrompt,
  consolidateShortTerm,
  planShortTerm,
  type ShortTermMessage,
  type ShortTermPlan,
  type ShortTermState,
} from '@chatvein/memory'
import { createEndpointModel } from '@chatvein/models'
import { emitTelemetry } from '@chatvein/observability'
import { MAIN_AGENT_ID } from '../../agent/agent.types'
import { AgentService } from '../../agent/agent.service'
import { ModelService } from '../../model/model.service'
import type { ModelConfig } from '../../model/model.types'
import type { ChatStreamEvent, Conversation } from '../chat.types'
import {
  readShortTermState,
  writeShortTermState,
} from './short-term.store'
import { ChatLlmHelper } from '../turn/llm'

/** 短期记忆：给本轮用户消息预留的 token（不占用窗口预算） */
const SHORT_TERM_RESERVE_TOKENS = 800

@Injectable()
export class ShortTermMemory {
  @Inject(AgentService)
  private agents!: AgentService

  @Inject(ModelService)
  private models!: ModelService

  @Inject(ChatLlmHelper)
  private llm!: ChatLlmHelper

  /** 每会话串行化短期记忆压缩，避免并发写同一份状态 */
  private queue = new Map<string, Promise<void>>()

  dropQueue(conversationId: string): void {
    this.queue.delete(conversationId)
  }

  /**
   * 短期记忆读路径：会话全量历史 → `摘要块（system） + 近因窗口`。
   * `dropLast` 用于 retry：会话末尾那条用户消息是本轮输入，不算历史。
   */
  async buildHistory(
    conv: Conversation,
    state: ShortTermState | null,
    opts?: { dropLast?: boolean },
  ): Promise<{
    history: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
    plan: ShortTermPlan
  }> {
    const source = opts?.dropLast ? conv.messages.slice(0, -1) : conv.messages
    const messages = toShortTermMessages(source)
    const plan = await planShortTerm({ messages, state, reserveTokens: SHORT_TERM_RESERVE_TOKENS })
    const history: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = []
    if (plan.summaryBlock) history.push(plan.summaryBlock)
    for (const m of plan.active) history.push({ role: m.role, content: m.content })
    return { history, plan }
  }

  /** 本轮结束后异步压缩短期记忆（不阻塞回复返回，按会话串行） */
  scheduleConsolidation(
    conv: Conversation,
    emit: ((evt: ChatStreamEvent) => void) | undefined,
    runId: string,
  ): void {
    const prev = this.queue.get(conv.id) ?? Promise.resolve()
    const next = prev
      .catch(() => undefined)
      .then(() => this.runConsolidation(conv, emit, runId))
      .catch((err) => {
        console.warn('[ChatService] short-term consolidation failed', err)
      })
    this.queue.set(conv.id, next)
    void next.finally(() => {
      if (this.queue.get(conv.id) === next) this.queue.delete(conv.id)
    })
  }

  private async runConsolidation(
    conv: Conversation,
    emit: ((evt: ChatStreamEvent) => void) | undefined,
    runId: string,
  ): Promise<void> {
    const state = await readShortTermState(conv.workspacePath)
    const messages = toShortTermMessages(conv.messages)

    // 先探一次：没有待摘要消息就不必解析模型配置
    if ((await planShortTerm({ messages, state })).pending.length === 0) return

    const agent = await this.agents.get(conv.agentId || MAIN_AGENT_ID)
    if (!agent?.modelId) return
    const model = await this.models.get(agent.modelId)
    if (!model?.enabled || !model.baseUrl?.trim() || !model.model?.trim()) return

    // 异步压缩发生在请求 sink 已清理之后：为本任务单独挂遥测通道
    const clear = this.llm.beginRequestTelemetry(emit, runId, conv.id)
    try {
      const summarizer = await this.summarizer(model)
      const result = await consolidateShortTerm({ messages, state, summarizer })
      if (result.consolidated === 0) return

      await writeShortTermState(conv.workspacePath, result.state)
      emitTelemetry('trace:memory:short-term', {
        consolidated: result.consolidated,
        viaModel: result.viaModel,
        summarizedCount: result.state.summarizedCount,
        summaryChars: result.state.summary.length,
        summary: result.state.summary,
      })
    } finally {
      clear?.()
    }
  }

  /** 摘要器：weak 档模型 + 短输出；调用失败由 consolidate 内部降级 */
  private async summarizer(agentModel: ModelConfig) {
    const weak = await this.llm.resolveL2Model(agentModel)
    const endpoint = createEndpointModel({
      id: weak.id,
      baseUrl: weak.baseUrl,
      apiKey: weak.apiKey,
      model: weak.model,
      temperature: 0,
      maxTokens: 512,
    })
    return async (input: Parameters<typeof buildSummarizePrompt>[0]): Promise<string> => {
      const [system, user] = buildSummarizePrompt(input)
      const res = await endpoint.invoke(
        [
          { role: 'system', content: system.content },
          { role: 'user', content: user.content },
        ],
        { timeoutMs: 20_000 },
      )
      return res.content
    }
  }
}

/** ChatMessage[] → ShortTermMessage[]（id 作摘要游标） */
export function toShortTermMessages(messages: Conversation['messages']): ShortTermMessage[] {
  return messages.map((m) => ({
    id: m.id,
    role: m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user',
    content: m.content,
    ...(m.failed ? { failed: true } : {}),
  }))
}

/** 短期记忆裁剪结果 → 思考面板一行 */
export function formatShortTermThinking(plan: ShortTermPlan): string {
  const s = plan.stats
  const parts = [
    `窗口 ${s.activeCount} 条`,
    `摘要覆盖 ${s.summarizedCount} 条`,
    `待摘要 ${s.pendingCount} 条`,
    `约 ${s.estimatedTokens} tokens`,
  ]
  if (s.truncatedCount > 0) parts.push(`折叠 ${s.truncatedCount} 条`)
  if (!s.cursorValid) parts.push('游标失效→重算')
  return `短期记忆：${parts.join(' / ')}\n`
}

/** 短期记忆 → trace:react:request.shortTerm 字段 */
export function shortTermDebugInfo(plan: ShortTermPlan) {
  return {
    activeCount: plan.stats.activeCount,
    summarizedCount: plan.stats.summarizedCount,
    pendingCount: plan.stats.pendingCount,
    estimatedTokens: plan.stats.estimatedTokens,
    truncatedCount: plan.stats.truncatedCount,
    cursorValid: plan.stats.cursorValid,
    summaryChars: plan.summaryBlock?.content.length ?? 0,
  }
}
