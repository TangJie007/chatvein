import { Injectable, type OnModuleInit } from '@electrum/common'
import { promises as fs } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { openApiKey, sealApiKey } from './secret.crypto'
import type { ModelConfig, ModelConfigDisk, ModelStoreFile } from './model.types'

interface ModelStoreMemory {
  version: 2
  models: ModelConfig[]
}

/**
 * 模型配置的 JSON 文件持久化。
 * 落在 userData/forge/models.json；API Key 以 enc:v1 密文落盘。
 */
@Injectable()
export class ModelStore implements OnModuleInit {
  private readonly file: string
  private cache: ModelStoreMemory | null = null

  constructor(file?: string) {
    this.file = file ?? join(app.getPath('userData'), 'forge', 'models.json')
  }

  async onModuleInit(): Promise<void> {
    await this.load()
  }

  async load(): Promise<ModelStoreMemory> {
    if (this.cache) return this.cache
    try {
      const raw = await fs.readFile(this.file, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<ModelStoreFile> & { version?: number }
      this.cache = await this.hydrate(parsed)
      // 旧明文 / 空种子 → 写回加密格式
      await this.persist()
    } catch {
      this.cache = { version: 2, models: [] }
      await this.persist()
    }
    return this.cache!
  }

  async save(data: ModelStoreMemory): Promise<void> {
    this.cache = data
    await this.persist()
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true })
    const disk: ModelStoreFile = {
      version: 2,
      models: await Promise.all((this.cache?.models ?? []).map((m) => this.toDisk(m))),
    }
    const tmp = `${this.file}.tmp`
    await fs.writeFile(tmp, JSON.stringify(disk, null, 2), 'utf-8')
    await fs.rename(tmp, this.file)
  }

  private async hydrate(data: Partial<ModelStoreFile> & { version?: number }): Promise<ModelStoreMemory> {
    const rawModels = Array.isArray(data.models) ? data.models : []
    // 去掉一期写入的空 Key 示例种子（用户未真正配置过）
    const cleaned = rawModels.filter((m) => !isEmptySeed(m))
    const models = await Promise.all(cleaned.map((m) => this.fromDisk(m)))
    return { version: 2, models }
  }

  private async fromDisk(row: ModelConfigDisk): Promise<ModelConfig> {
    const sealed = row.apiKeyEnc ?? row.apiKey ?? ''
    const apiKey = await openApiKey(sealed)
    return {
      id: row.id,
      name: row.name,
      protocol: 'openai',
      provider: row.provider,
      baseUrl: row.baseUrl,
      apiKey,
      model: row.model,
      temperature: row.temperature,
      maxTokens: row.maxTokens,
      enabled: row.enabled !== false,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }
  }

  private async toDisk(m: ModelConfig): Promise<ModelConfigDisk> {
    return {
      id: m.id,
      name: m.name,
      protocol: 'openai',
      provider: m.provider,
      baseUrl: m.baseUrl,
      apiKeyEnc: await sealApiKey(m.apiKey),
      model: m.model,
      temperature: m.temperature,
      maxTokens: m.maxTokens,
      enabled: m.enabled,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
    }
  }
}

/** 识别首次启动写过的 DeepSeek/GPT 空配置，避免当作用户数据保留 */
function isEmptySeed(m: ModelConfigDisk): boolean {
  const noKey = !(m.apiKeyEnc || m.apiKey)
  const known =
    (m.id === 'deepseek-chat' && m.model === 'deepseek-chat') ||
    (m.id === 'gpt-4.1' && m.model === 'gpt-4.1')
  return noKey && known
}
