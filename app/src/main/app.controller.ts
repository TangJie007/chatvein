import { join } from 'node:path'
import { app } from 'electron'
import { Controller, IpcHandle, AppEvent, Inject } from '@electrum/common'
import { ConfigService } from './config.service'

@Controller('app')
export class AppController {
  @Inject(ConfigService)
  config!: ConfigService

  @IpcHandle('info')
  getInfo() {
    return {
      name: this.config.appName,
      version: this.config.version,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
      demoFile: join(app.getPath('userData'), 'electrum-demo.txt'),
    }
  }

  @IpcHandle('ping')
  ping(message: string) {
    return { echo: message, at: Date.now() }
  }

  @AppEvent('window-all-closed')
  onAllClosed() {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  }
}
