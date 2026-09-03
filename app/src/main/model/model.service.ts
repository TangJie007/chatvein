import { Injectable, Inject, NotFoundException } from '@electrum/common'
import { randomUUID } from 'node:crypto'
import { ModelStore } from './model.store'
import {
  PROVIDER_PRESETS,
  type ConnectionTestResult,
  type ModelConfig,
  type ProviderPreset,
} from './model.types'

/** 渲染端提交的可编辑字段 */
export interface ModelInput {
  name?: string
  protocol?: 'openai'
  provider?: string
  baseUrl?: string
  apiKey?: string
  model?: string
  temperature?: number
  maxTokens?: number
  enabled?: boolean
}

@Injectable()
export class ModelService {
  @Inject(ModelStore)
  private store!: ModelStore

  listPresets(): ProviderPreset[] {
    return PROVIDER_PRESETS
  }

  async list(): Promise<ModelConfig[]> {
    const data = await this.store.load()
    return [...data.models].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async get(id: string): Promise<ModelConfig> {
    const data = await this.store.load()
    const model = data.models.find((m) => m.id === id)
    if (!model) throw new NotFoundException(`model:${id}`)
    return model
  }

  async create(input: ModelInput = {}): Promise<ModelConfig> {
    const data = await this.store.load()
    const now = Date.now()
    const provider = input.provider ?? 'custom'
    const presetModels = this.presetModels(provider)
    const modelId = input.model ?? presetModels[0] ?? ''
    const model: ModelConfig = {
      id: randomUUID(),
      name: input.name?.trim() || modelId || `新模型 ${data.models.length + 1}`,
      protocol: 'openai',
      provider,
      baseUrl: input.baseUrl ?? this.presetBase(provider),
      apiKey: input.apiKey ?? '',
      model: modelId,
      temperature: clamp(input.temperature ?? 0.3, 0, 2),
      maxTokens: Math.round(input.maxTokens ?? 4096),
      enabled: input.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    }
    data.models.push(model)
    await this.store.save(data)
    return model
  }

  async update(id: string, patch: ModelInput): Promise<ModelConfig> {
    const data = await this.store.load()
    const idx = data.models.findIndex((m) => m.id === id)
    if (idx === -1) throw new NotFoundException(`model:${id}`)
    const prev = data.models[idx]
    const next: ModelConfig = {
      ...prev,
      ...stripUndefined(patch),
      protocol: 'openai',
      temperature: patch.temperature != null ? clamp(patch.temperature, 0, 2) : prev.temperature,
      maxTokens: patch.maxTokens != null ? Math.round(patch.maxTokens) : prev.maxTokens,
      updatedAt: Date.now(),
    }
    data.models[idx] = next
    await this.store.save(data)
    return next
  }

  async remove(id: string): Promise<{ ok: true }> {
    const data = await this.store.load()
    const idx = data.models.findIndex((m) => m.id === id)
    if (idx === -1) throw new NotFoundException(`model:${id}`)
    data.models.splice(idx, 1)
    await this.store.save(data)
    return { ok: true }
  }

  /**
   * OpenAI 兼容连通性测试：POST {baseUrl}/chat/completions，max_tokens=1。
   */
  async testConnection(input: {
    baseUrl: string
    apiKey: string
    model: string
  }): Promise<ConnectionTestResult> {
    const base = (input.baseUrl || '').trim().replace(/\/+$/, '')
    if (!base) return { ok: false, latencyMs: 0, message: 'Base URL 为空' }
    if (!/^https?:\/\//i.test(base)) return { ok: false, latencyMs: 0, message: 'Base URL 需以 http(s):// 开头' }
    if (!input.model?.trim()) return { ok: false, latencyMs: 0, message: '模型名为空' }

    const url = `${base}/chat/completions`
    const started = Date.now()
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 15000)
      const res = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(input.apiKey ? { Authorization: `Bearer ${input.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: input.model,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
          stream: false,
        }),
      })
      clearTimeout(timer)
      const latencyMs = Date.now() - started

      if (res.ok) {
        return { ok: true, latencyMs, message: '连通正常', model: input.model }
      }
      const detail = await safeErrorText(res)
      return {
        ok: false,
        latencyMs,
        message: res.status === 401 ? '鉴权失败：API Key 无效' : `HTTP ${res.status}${detail ? ` · ${detail}` : ''}`,
      }
    } catch (err) {
      const latencyMs = Date.now() - started
      const aborted = err instanceof Error && err.name === 'AbortError'
      return {
        ok: false,
        latencyMs,
        message: aborted ? '连接超时（15s）' : `无法连接：${(err as Error).message}`,
      }
    }
  }

  private presetBase(provider?: string): string {
    return PROVIDER_PRESETS.find((p) => p.value === provider)?.baseUrl ?? ''
  }
  private presetModels(provider?: string): string[] {
    return PROVIDER_PRESETS.find((p) => p.value === provider)?.models ?? []
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>
}

async function safeErrorText(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } }
    return body?.error?.message?.slice(0, 160) ?? ''
  } catch {
    try {
      return (await res.text()).slice(0, 160)
    } catch {
      return ''
    }
  }
}
