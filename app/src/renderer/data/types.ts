export type AvatarTint =
  | 'indigo'
  | 'sky'
  | 'peach'
  | 'clay'
  | 'rose'
  | 'slate'
  | 'teal'
  | 'violet'

export type DotState = 'online' | 'thinking' | 'idle' | 'err' | 'none'

export interface ConversationRow {
  id: string
  name: string
  initial: string
  tint: AvatarTint
  dot?: DotState
  pinned?: boolean
  sub: string
  time: string
  badge?: number | 'dot'
  badgeTone?: 'default' | 'warn' | 'muted'
  section: string
  cRole: string
  cStatus: string
  cModel: string
}

export interface AgentRow {
  id: string
  name: string
  role: string
  initial: string
  tint: AvatarTint
  dot?: DotState
  provider: string
  providerLabel: string
  model: string
  toolCount: number
  enabled: boolean
}

export interface GroupRow {
  id: string
  name: string
  sub: string
  time: string
  badge?: number | 'dot'
  badgeTone?: 'default' | 'warn' | 'muted'
  stack: Array<{ initial: string; tint: AvatarTint }>
  mode: '主管制' | '轮询' | '自由讨论'
  members: string
}

export interface KbRow {
  id: string
  name: string
  initial: string
  tint: AvatarTint
  sub: string
  status: 'ready' | 'indexing' | 'off'
  statusLabel: string
  docs: string
  chunks: string
  embed: string
  store: string
  topK: string
  thresh: string
  chunk: string
  overlap: string
}

export interface McpRow {
  id: string
  name: string
  initial: string
  tint: AvatarTint
  transport: 'stdio' | 'sse'
  tools: number
  cmd: string
  status: 'on' | 'err' | 'off'
  statusLabel: string
  latency: string
}

export interface SkillRow {
  id: string
  name: string
  initial: string
  tint: AvatarTint
  cat: string
  version: string
  desc: string
  owner: string
  files: string
  triggers: string[]
  enabled: boolean
}
