import { Controller, IpcHandle, Inject } from '@electrum/common'
import { SettingsService } from './settings.service'
import type { AppSettingsPatch, AppSettingsView } from './settings.types'

@Controller('settings')
export class SettingsController {
  @Inject(SettingsService)
  settings!: SettingsService

  @IpcHandle('get')
  get(): Promise<AppSettingsView> {
    return this.settings.get()
  }

  @IpcHandle('update')
  update(patch: AppSettingsPatch): Promise<AppSettingsView> {
    return this.settings.update(patch ?? {})
  }

  @IpcHandle('reset')
  reset(): Promise<AppSettingsView> {
    return this.settings.reset()
  }

  @IpcHandle('pickFolder')
  pickFolder(data?: { title?: string; defaultPath?: string }): Promise<string | null> {
    return this.settings.pickFolder(data)
  }
}
