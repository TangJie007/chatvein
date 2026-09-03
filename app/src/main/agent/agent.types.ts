// 主进程侧 Agent 配置类型。渲染端契约见 src/renderer/ipc-api.ts（保持字段一致）。

export type AvatarTint =
  | 'indigo'
  | 'sky'
  | 'peach'
  | 'clay'
  | 'rose'
  | 'slate'
  | 'teal'
  | 'violet'

/** 主对话 Agent 的固定 id（路由 / 默认会话使用，不可删除） */
export const MAIN_AGENT_ID = 'main'

export interface AgentConfig {
  id: string
  /** 是否为主对话 Agent（默认路由 / 普通对话）；全局唯一，不可删除 */
  isMain?: boolean
  name: string
  role: string
  desc: string
  initial: string
  tint: AvatarTint
  /** 绑定的模型配置 id（来自模型选型） */
  modelId: string
  enabled: boolean
  /** 一期占位：工具白名单，能力绑定接入后再真正过滤 */
  tools: string[]
  /** 一期占位：Skills 绑定列表 */
  skills: string[]
  /** 一期占位：知识库绑定列表 */
  knowledgeBases: string[]
  systemPrompt: string
  createdAt: number
  updatedAt: number
}

/** 落盘结构（带版本号，便于后续迁移） */
export interface AgentStoreFile {
  version: 2
  mainAgentId: string
  agents: AgentConfig[]
}
