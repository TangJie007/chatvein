/**
 * general worker（react_chat）：计划 → 逐项执行（含工具筛选 / 自检）→ 设计文档。
 *
 * 编排实现见 `./agent`（`createChatAgent`）；母图侧由 `lanes/agentic` 装配为节点。
 */
export {
  createChatAgent,
  type ChatAgent,
  type ChatAgentInvokeInput,
  type ChatAgentInvokeResult,
  type CreateChatAgentOptions,
} from './agent'
export { DEFAULT_CHAT_SYSTEM_PROMPT } from './prompt'
