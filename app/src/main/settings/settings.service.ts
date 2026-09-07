import { Injectable, Inject, ValidationException } from '@electrum/common'
import { mkdir } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { BrowserWindow, dialog } from 'electron'
import { SettingsStore } from './settings.store'
import type { AppSettings, AppSettingsPatch, AppSettingsView } from './settings.types'

@Injectable()
export class SettingsService {
  @Inject(SettingsStore)
  private store!: SettingsStore

  async get(): Promise<AppSettingsView> {
    const s = await this.store.load()
    return this.toView(s)
  }

  async update(patch: AppSettingsPatch): Promise<AppSettingsView> {
    const prev = await this.store.load()
    const next: AppSettings = {
      ...prev,
      ...stripUndefined(patch),
      version: 1,
    }
    if (patch.workspaceRoot != null) {
      next.workspaceRoot = normalizePath(patch.workspaceRoot)
    }
    // 项目根为用户既有真实目录：仅校验绝对路径，不代为创建
    if (patch.devProjectRoot != null) {
      next.devProjectRoot = normalizePath(patch.devProjectRoot)
    }
    await ensureDir(this.effectiveWorkspace(next))
    await this.store.save(next)
    return this.toView(next)
  }

  async reset(): Promise<AppSettingsView> {
    const next: AppSettings = {
      version: 1,
      workspaceRoot: this.store.defaultWorkspaceRoot(),
      devProjectRoot: '',
      cmdAllowlist: true,
      confirmWrites: true,
      reduceMotion: false,
      confirmForgeStart: true,
      forgeBuildCommand: '',
      forgeTestCommand: '',
      forgeSkipBuild: false,
    }
    await ensureDir(next.workspaceRoot)
    await this.store.save(next)
    return this.toView(next)
  }

  /**
   * 系统文件夹选择器。返回选中路径；取消则 null。
   */
  async pickFolder(opts?: { title?: string; defaultPath?: string }): Promise<string | null> {
    const win = BrowserWindow.getFocusedWindow()
    const options = {
      title: opts?.title ?? '选择文件夹',
      defaultPath: opts?.defaultPath || undefined,
      properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>,
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  }

  private toView(s: AppSettings): AppSettingsView {
    const defaultWorkspaceRoot = this.store.defaultWorkspaceRoot()
    return {
      ...s,
      defaultWorkspaceRoot,
      effectiveWorkspaceRoot: this.effectiveWorkspace(s),
    }
  }

  private effectiveWorkspace(s: AppSettings): string {
    return s.workspaceRoot.trim() || this.store.defaultWorkspaceRoot()
  }
}

function normalizePath(p: string): string {
  const t = p.trim()
  if (!t) return ''
  if (!isAbsolute(t)) {
    throw new ValidationException('路径必须是绝对路径', [])
  }
  return t
}

async function ensureDir(p: string): Promise<void> {
  if (!p) return
  await mkdir(p, { recursive: true })
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>
}
