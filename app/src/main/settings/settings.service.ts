import { Injectable } from '@electrum/common'

export interface AppSettings {
  theme: 'light' | 'dark' | 'system'
  model: string
  language: string
  sendOnEnter: boolean
}

export interface SettingsPatch {
  theme?: 'light' | 'dark' | 'system'
  model?: string
  language?: string
  sendOnEnter?: boolean
}

const DEFAULTS: AppSettings = {
  theme: 'system',
  model: 'gpt-4o-mini',
  language: 'zh-CN',
  sendOnEnter: true,
}

/**
 * 设置服务（内存实现）。
 *
 * 后续替换为落盘存储时，只需改这里的读写实现，IPC 契约保持不变。
 */
@Injectable()
export class SettingsService {
  private settings: AppSettings = { ...DEFAULTS }

  get(): AppSettings {
    return { ...this.settings }
  }

  set(patch: SettingsPatch): AppSettings {
    this.settings = { ...this.settings, ...patch }
    return { ...this.settings }
  }

  reset(): AppSettings {
    this.settings = { ...DEFAULTS }
    return { ...this.settings }
  }
}
