import { Injectable } from '@electrum/common'
import { promises as fs } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { MAIN_AGENT_ID, type AgentConfig, type AgentStoreFile } from './agent.types'

/**
 * Agent 配置的 JSON 文件持久化。
 *
 * 落在 userData/forge/agents.json；纯主进程读写，渲染端只能经 IPC 访问。
 * 一期用 JSON 文件即可（单机单用户、配置量小）；后续若上 PGlite 可平移。
 */
@Injectable()
export class AgentStore {
  private readonly file: string
  private cache: AgentStoreFile | null = null

  constructor(file?: string) {
    this.file = file ?? join(app.getPath('userData'), 'forge', 'agents.json')
  }

  async load(): Promise<AgentStoreFile> {
    if (this.cache) return this.cache
    try {
      const raw = await fs.readFile(this.file, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<AgentStoreFile> & { agents?: unknown[] }
      this.cache = this.migrate(parsed)
      // 从 v1（内嵌 API 字段）迁到 v2（modelId）后写回
      if ((parsed as { version?: number }).version !== 2) {
        await this.persist()
      }
    } catch {
      this.cache = this.defaults()
      await this.persist()
    }
    return this.cache!
  }

  async save(data: AgentStoreFile): Promise<void> {
    this.cache = data
    await this.persist()
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    await fs.writeFile(tmp, JSON.stringify(this.cache, null, 2), 'utf-8')
    await fs.rename(tmp, this.file)
  }

  /** 轻量迁移：补齐缺失字段 / 保证主对话 Agent 存在；v1→v2 去掉内嵌 API 改绑 modelId */
  private migrate(data: Partial<AgentStoreFile> & { agents?: unknown[] }): AgentStoreFile {
    const defaults = this.defaults()
    const rawAgents = Array.isArray(data.agents) ? data.agents : []
    const agents = rawAgents.map((raw) => normalizeAgent(raw as Record<string, unknown>, defaults))
    const byId = new Map(agents.map((a) => [a.id, a]))
    if (!byId.has(MAIN_AGENT_ID)) byId.set(MAIN_AGENT_ID, defaults.agents[0])
    return {
      version: 2,
      mainAgentId: MAIN_AGENT_ID,
      agents: [...byId.values()],
    }
  }

  private defaults(): AgentStoreFile {
    const now = Date.now()
    const main: AgentConfig = {
      id: MAIN_AGENT_ID,
      isMain: true,
      name: '主对话',
      role: '默认助手',
      desc: '主对话窗口使用的默认 Agent；普通对话、快速提问都走这里。',
      initial: '主',
      tint: 'indigo',
      modelId: '',
      enabled: true,
      tools: [],
      skills: [],
      knowledgeBases: [],
      systemPrompt:
        '你是 Chatvein 的主对话助手，负责理解用户意图、协调可用能力完成任务。\n\n约定：\n1. 不确定时先用一句话澄清，不要臆测；\n2. 输出优先表格 / 列表，避免长段落；\n3. 涉及写文件、删除、外部请求等有副作用的操作，先说明再执行。',
      createdAt: now,
      updatedAt: now,
    }
    const coder: AgentConfig = {
      id: 'coder',
      isMain: false,
      name: 'CodeReview',
      role: '代码评审',
      desc: 'Vue3 + TS 变更审查：类型、响应式、体积、可访问性。',
      initial: 'R',
      tint: 'violet',
      modelId: '',
      enabled: true,
      tools: ['file_read'],
      skills: ['frontend-code-review'],
      knowledgeBases: [],
      systemPrompt:
        '你是资深前端评审。按 类型收敛 / 响应式陷阱 / 构建体积 / 可访问性 四类给意见，给出行号与改法。',
      createdAt: now,
      updatedAt: now,
    }
    return { version: 2, mainAgentId: MAIN_AGENT_ID, agents: [main, coder] }
  }
}

function normalizeAgent(raw: Record<string, unknown>, defaults: AgentStoreFile): AgentConfig {
  const id = typeof raw.id === 'string' ? raw.id : ''
  const fallback = defaults.agents.find((a) => a.id === id) ?? defaults.agents[0]
  // v1 曾内嵌 model 字符串；优先用显式 modelId，否则按旧 model 名映射到默认模型 id
  const legacyModel = typeof raw.model === 'string' ? raw.model : ''
  const modelId =
    (typeof raw.modelId === 'string' && raw.modelId) ||
    (legacyModel === 'gpt-4.1' || legacyModel === 'gpt-4o' ? 'gpt-4.1' : '') ||
    fallback.modelId

  return {
    id: id || fallback.id,
    isMain: Boolean(raw.isMain) || id === MAIN_AGENT_ID,
    name: typeof raw.name === 'string' ? raw.name : fallback.name,
    role: typeof raw.role === 'string' ? raw.role : fallback.role,
    desc: typeof raw.desc === 'string' ? raw.desc : fallback.desc,
    initial: typeof raw.initial === 'string' ? raw.initial : fallback.initial,
    tint: (typeof raw.tint === 'string' ? raw.tint : fallback.tint) as AgentConfig['tint'],
    modelId,
    enabled: raw.enabled === false ? false : true,
    tools: Array.isArray(raw.tools) ? (raw.tools as string[]) : fallback.tools,
    skills: Array.isArray(raw.skills) ? (raw.skills as string[]) : fallback.skills,
    knowledgeBases: Array.isArray(raw.knowledgeBases)
      ? (raw.knowledgeBases as string[])
      : fallback.knowledgeBases,
    systemPrompt: typeof raw.systemPrompt === 'string' ? raw.systemPrompt : fallback.systemPrompt,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : fallback.createdAt,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : fallback.updatedAt,
  }
}
