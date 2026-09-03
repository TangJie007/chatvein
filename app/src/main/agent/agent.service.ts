import { Injectable, Inject, NotFoundException, ValidationException } from '@electrum/common'
import { randomUUID } from 'node:crypto'
import { AgentStore } from './agent.store'
import { MAIN_AGENT_ID, type AgentConfig, type AvatarTint } from './agent.types'

/** 渲染端提交的可编辑字段（id / isMain / 时间戳由主进程管理） */
export interface AgentInput {
  name?: string
  role?: string
  desc?: string
  initial?: string
  tint?: AvatarTint
  modelId?: string
  enabled?: boolean
  tools?: string[]
  skills?: string[]
  knowledgeBases?: string[]
  systemPrompt?: string
}

const TINTS: AvatarTint[] = ['indigo', 'sky', 'peach', 'clay', 'rose', 'slate', 'teal', 'violet']

@Injectable()
export class AgentService {
  @Inject(AgentStore)
  private store!: AgentStore

  async list(): Promise<AgentConfig[]> {
    const data = await this.store.load()
    return [...data.agents].sort((a, b) => Number(b.isMain ?? false) - Number(a.isMain ?? false))
  }

  async get(id: string): Promise<AgentConfig> {
    const data = await this.store.load()
    const agent = data.agents.find((a) => a.id === id)
    if (!agent) throw new NotFoundException(`agent:${id}`)
    return agent
  }

  async create(input: AgentInput = {}): Promise<AgentConfig> {
    const data = await this.store.load()
    const now = Date.now()
    const n = data.agents.length + 1
    const agent: AgentConfig = {
      id: randomUUID(),
      isMain: false,
      name: input.name?.trim() || `新 Agent ${n}`,
      role: input.role ?? '自定义角色',
      desc: input.desc ?? '',
      initial: input.initial || (input.name?.trim()?.[0] ?? 'A'),
      tint: input.tint ?? TINTS[n % TINTS.length],
      modelId: input.modelId ?? '',
      enabled: input.enabled ?? true,
      tools: input.tools ?? [],
      skills: input.skills ?? [],
      knowledgeBases: input.knowledgeBases ?? [],
      systemPrompt: input.systemPrompt ?? '',
      createdAt: now,
      updatedAt: now,
    }
    data.agents.push(agent)
    await this.store.save(data)
    return agent
  }

  async update(id: string, patch: AgentInput): Promise<AgentConfig> {
    const data = await this.store.load()
    const idx = data.agents.findIndex((a) => a.id === id)
    if (idx === -1) throw new NotFoundException(`agent:${id}`)
    const prev = data.agents[idx]
    const next: AgentConfig = {
      ...prev,
      ...stripUndefined(patch),
      enabled: prev.isMain ? true : patch.enabled ?? prev.enabled,
      updatedAt: Date.now(),
    }
    data.agents[idx] = next
    await this.store.save(data)
    return next
  }

  async remove(id: string): Promise<{ ok: true }> {
    if (id === MAIN_AGENT_ID) {
      throw new ValidationException('主对话 Agent 不可删除', [])
    }
    const data = await this.store.load()
    const idx = data.agents.findIndex((a) => a.id === id)
    if (idx === -1) throw new NotFoundException(`agent:${id}`)
    data.agents.splice(idx, 1)
    await this.store.save(data)
    return { ok: true }
  }
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>
}
