import { Injectable } from '@electrum/common'
import { promises as fs } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import type { AppSettings } from './settings.types'

@Injectable()
export class SettingsStore {
  private readonly file: string
  private cache: AppSettings | null = null

  constructor(file?: string) {
    this.file = file ?? join(app.getPath('userData'), 'forge', 'settings.json')
  }

  defaultWorkspaceRoot(): string {
    return join(app.getPath('documents'), 'Chatvein', 'workspaces')
  }

  defaultRunsRoot(): string {
    return join(app.getPath('documents'), 'Chatvein', 'runs')
  }

  async load(): Promise<AppSettings> {
    if (this.cache) return this.cache
    try {
      const raw = await fs.readFile(this.file, 'utf-8')
      this.cache = this.migrate(JSON.parse(raw) as Partial<AppSettings>)
    } catch {
      this.cache = this.defaults()
      await this.persist()
    }
    return this.cache!
  }

  async save(data: AppSettings): Promise<void> {
    this.cache = data
    await this.persist()
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    await fs.writeFile(tmp, JSON.stringify(this.cache, null, 2), 'utf-8')
    await fs.rename(tmp, this.file)
  }

  private migrate(data: Partial<AppSettings>): AppSettings {
    const d = this.defaults()
    return {
      version: 1,
      workspaceRoot: typeof data.workspaceRoot === 'string' ? data.workspaceRoot : d.workspaceRoot,
      runsRoot: typeof data.runsRoot === 'string' ? data.runsRoot : d.runsRoot,
      cmdAllowlist: data.cmdAllowlist !== false,
      confirmWrites: data.confirmWrites !== false,
      reduceMotion: data.reduceMotion === true,
    }
  }

  private defaults(): AppSettings {
    return {
      version: 1,
      // 首次即指向「文档」下，避免默认堆在 AppData（C 盘）
      workspaceRoot: this.defaultWorkspaceRoot(),
      runsRoot: this.defaultRunsRoot(),
      cmdAllowlist: true,
      confirmWrites: true,
      reduceMotion: false,
    }
  }
}
