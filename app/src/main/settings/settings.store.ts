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

  async load(): Promise<AppSettings> {
    if (this.cache) return this.cache
    try {
      const raw = await fs.readFile(this.file, 'utf-8')
      this.cache = this.migrate(JSON.parse(raw) as Partial<AppSettings> & { runsRoot?: string })
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

  private migrate(data: Partial<AppSettings> & { runsRoot?: string }): AppSettings {
    const d = this.defaults()
    // 旧版 runsRoot 已废弃：沙箱改为会话目录下 runs/
    return {
      version: 1,
      workspaceRoot: typeof data.workspaceRoot === 'string' ? data.workspaceRoot : d.workspaceRoot,
      devProjectRoot: typeof data.devProjectRoot === 'string' ? data.devProjectRoot : d.devProjectRoot,
      cmdAllowlist: data.cmdAllowlist !== false,
      confirmWrites: data.confirmWrites !== false,
      reduceMotion: data.reduceMotion === true,
    }
  }

  private defaults(): AppSettings {
    return {
      version: 1,
      workspaceRoot: this.defaultWorkspaceRoot(),
      devProjectRoot: '',
      cmdAllowlist: true,
      confirmWrites: true,
      reduceMotion: false,
    }
  }
}
