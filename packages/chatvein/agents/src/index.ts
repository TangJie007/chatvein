/**
 * @chatvein/agents
 *
 * Agent runtime: LangGraph createReactAgent (ReAct) for chat and group members.
 */

export const CHATVEIN_AGENTS_VERSION = '0.1.0'

export {
  createReactChatAgent,
  invokeReactChatAgent,
  extractFinalAssistantText,
  type CreateReactChatAgentOptions,
  type ReactChatAgent,
  type ReactChatInput,
  type ReactChatResult,
} from './react-agent'

export { defineAgentTool } from './define-tool'
