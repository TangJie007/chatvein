import { Injectable, Logger, type OnAppReady, type OnModuleDestroy } from '@electrum/common'

export interface AppInfo {
  name: string
  version: string
  electron: string
  node: string
  chrome: string
  platform: string
}

/** 应用级服务：目前只承载问候语与运行时信息，后续可挂载真正的宿主能力。 */
@Injectable()
export class AppService implements OnAppReady, OnModuleDestroy {
  private readonly logger = new Logger('AppService')

  onAppReady(): void {
    this.logger.log('application ready')
  }

  onModuleDestroy(): void {
    this.logger.log('application shutting down')
  }

  greet(name: string): string {
    return `Hello, ${name || 'world'}!`
  }

  info(): AppInfo {
    return {
      name: 'Chatvein',
      version: '0.1.0',
      electron: process.versions.electron ?? 'unknown',
      node: process.versions.node,
      chrome: process.versions.chrome ?? 'unknown',
      platform: process.platform,
    }
  }
}
