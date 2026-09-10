/**
 * 各 agent 共享的基础类型。
 */

/** 一条历史消息（角色 + 文本内容） */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}
