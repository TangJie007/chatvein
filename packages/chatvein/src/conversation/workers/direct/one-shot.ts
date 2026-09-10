/**
 * direct · one_shot：`readonly` / `full` 时的「至多 1 次工具」。
 *
 * **禁止**用 `createAgent` 冒充（易变多步）。做法（实现方案 §6）：
 * `model.bindTools(tools)` → 单次 invoke → 有 tool_calls 则**只执行第一个**
 * → 追加 ToolMessage → 再**一次** invoke 收束文案。无 tool_calls 则直接收束。
 */
import { AIMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages'
import { budgetExhaustedText, createBudgetTracker } from '../../budget'
import { bindToolsIfSupported, invokeModel, invokeToolCall } from '../../model'
import { resolveTools } from '../../tools'
import { lastHumanMessageText } from '../../../shared'
import type { ConversationState, ConversationStateUpdate } from '../../state'
import { beginDirectNode, directMessages, type DirectLaneOptions } from './shared'

export type OneShotOptions = DirectLaneOptions

export function createOneShotNode(
  options: OneShotOptions = {},
): (state: ConversationState) => Promise<ConversationStateUpdate> {
  return async function oneShot(
    state: ConversationState,
  ): Promise<ConversationStateUpdate> {
    const model = beginDirectNode(options, state, 'direct:one_shot')
    const tracker = createBudgetTracker(state.route.band, options.budgetPolicy)
    const tools = await resolveTools({
      tools: options.tools,
      toolsByDomain: options.toolsByDomain,
      resolver: options.toolsResolver,
      text: lastHumanMessageText(state.messages ?? []),
      route: state.route,
      domain: state.route.domain,
      toolsPolicy: state.route.toolsPolicy,
    })
    const bound = bindToolsIfSupported(model, tools)
    const history = directMessages(state, options.systemPrompt)

    const first = await invokeModel(bound, history, options.signal)
    tracker.tick({ steps: 1 })

    const out: BaseMessage[] = [first]
    const calls = first.tool_calls ?? []
    if (calls.length === 0 || tools.length === 0) return { messages: out }

    // 只取第一个 tool_call：多步工具链属于 agentic
    const call = calls[0]
    const callId = call.id ?? `call_${call.name}`
    const tool = tools.find((t) => t.name === call.name)

    if (!tool) {
      out.push(
        new ToolMessage({
          content: `未找到工具：${call.name}`,
          tool_call_id: callId,
          name: call.name,
          status: 'error',
        }),
      )
    } else {
      const verdict = tracker.probe({ toolCalls: 1 })
      if (verdict.kind !== 'ok') {
        out.push(new AIMessage(budgetExhaustedText(verdict)))
        return { messages: out }
      }
      const toolMessage = await invokeToolCall(tool, call)
      tracker.tick({ toolCalls: 1 })
      out.push(toolMessage)
    }

    const nextVerdict = tracker.probe({ steps: 1 })
    if (nextVerdict.kind !== 'ok') {
      out.push(new AIMessage(budgetExhaustedText(nextVerdict)))
      return { messages: out }
    }

    const final = await invokeModel(bound, [...history, ...out], options.signal)
    tracker.tick({ steps: 1 })
    out.push(final)
    return { messages: out }
  }
}
