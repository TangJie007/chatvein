/**
 * direct worker（小工具人）：START → {reply_only | one_shot} → END
 *
 * 与 general / code 同属 workers；母图 `direct` lane 挂本子图。
 * 分叉：route.toolsPolicy（none → reply_only；readonly / full → one_shot）。
 * @see docs/conversation-graph-implementation.md §6
 */
import { END, START, StateGraph } from '@langchain/langgraph'
import { ConversationStateAnnotation } from '../../state'
import { createOneShotNode } from './one-shot'
import { createReplyOnlyNode } from './reply-only'
import type { DirectLaneOptions } from './shared'

export type { DirectLaneOptions, DirectNodeOptions } from './shared'
export { createOneShotNode, type OneShotOptions } from './one-shot'
export { createReplyOnlyNode, type ReplyOnlyOptions } from './reply-only'
export { DEFAULT_DIRECT_SYSTEM_PROMPT } from './prompt'

export type DirectLaneNode = 'reply_only' | 'one_shot'

/** 供条件边使用：direct 分叉只取决于 toolsPolicy */
export function selectDirectNode(
  state: { route: { toolsPolicy: string } },
): DirectLaneNode {
  return state.route.toolsPolicy === 'none' ? 'reply_only' : 'one_shot'
}

/**
 * 编译 direct lane 子图（母图以 `addNode('direct', ...)` 复用）。
 */
export function createDirectLane(options: DirectLaneOptions = {}) {
  const nodeOptions = {
    model: options.model,
    systemPrompt: options.systemPrompt,
    budgetPolicy: options.budgetPolicy,
    signal: options.signal,
    hooks: options.hooks,
  }

  return new StateGraph(ConversationStateAnnotation)
    .addNode('reply_only', createReplyOnlyNode(nodeOptions))
    .addNode(
      'one_shot',
      createOneShotNode({
        ...nodeOptions,
        tools: options.tools,
        toolsByDomain: options.toolsByDomain,
        toolsResolver: options.toolsResolver,
      }),
    )
    .addConditionalEdges(START, selectDirectNode, {
      reply_only: 'reply_only',
      one_shot: 'one_shot',
    })
    .addEdge('reply_only', END)
    .addEdge('one_shot', END)
    .compile()
}
