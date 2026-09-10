import { Controller, Inject, IpcHandle } from '@electrum/common'
import { SettingsService, type AppSettings, type SettingsPatch } from './settings.service'

/** 设置域 IPC：`settings:*`。 */
@Controller('settings')
export class SettingsController {
  @Inject(SettingsService)
  settingsService!: SettingsService

  @IpcHandle('get')
  get(): AppSettings {
    return this.settingsService.get()
  }

  @IpcHandle('set')
  set(patch: SettingsPatch): AppSettings {
    return this.settingsService.set(patch)
  }

  @IpcHandle('reset')
  reset(): AppSettings {
    return this.settingsService.reset()
  }
}
