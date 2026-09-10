import { app } from 'electron'
import { AppEvent, Controller, Inject, IpcHandle } from '@electrum/common'
import { AppService } from './app.service'

/** 应用域 IPC：连通性探测与应用信息。 */
@Controller('app')
export class AppController {
  @Inject(AppService)
  appService!: AppService

  /** 连通性探测：渲染端启动时调用一次，确认 IPC 全链路可用。 */
  @IpcHandle('ping')
  ping(message: string): { echo: string; at: number } {
    return { echo: this.appService.greet(message), at: Date.now() }
  }

  /** 运行时信息（版本 / 平台），设置页展示用。 */
  @IpcHandle('info')
  info(): {
    name: string
    version: string
    electron: string
    node: string
    chrome: string
    platform: string
  } {
    return this.appService.info()
  }

  @AppEvent('window-all-closed')
  onAllClosed(): void {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  }
}
