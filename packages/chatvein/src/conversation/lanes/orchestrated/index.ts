/**
 * orchestrated lane：clarify → plan → HITL → execute → verify → deliver。
 *
 * **阶段 C 尚未接线**。为满足「不静默、不抛错」，当前实现直接复用
 * `agentic` 子图执行（设计红线：禁止复制流水线），并在 `task.resultSummary`
 * 明确标注降级，便于 UI / 日志识别「本轮本应走编排档」。
 */
import { cloneTask, type ConversationState, type ConversationStateUpdate } from '../../state'
import type { BudgetPolicy, ConversationHooks } from '../../types'
import { createAgenticLane, type AgenticLaneOptions } from '../agentic'

export { DEFAULT_ORCHESTRATED_SYSTEM_PROMPT } from './prompt'

export type OrchestratedLaneOptions = AgenticLaneOptions & {
  budgetPolicy?: BudgetPolicy
  hooks?: ConversationHooks
}

export function createOrchestratedLane(
  options: OrchestratedLaneOptions = {},
): (state: ConversationState) => Promise<ConversationStateUpdate> {
  const agentic = createAgenticLane({
    ...options,
    ...(options.name ? { name: `${options.name}:orchestrated` } : {}),
  })

  return async function orchestratedLane(
    state: ConversationState,
  ): Promise<ConversationStateUpdate> {
    options.hooks?.onNode?.('orchestrated', state)
    const update = await agentic(state)
    return {
      ...update,
      task: {
        ...cloneTask(state.task),
        resultSummary: 'orchestrated 档尚未接线（阶段 C），本轮已按 agentic 执行',
      },
    }
  }
}
