import { Injectable, Inject, OnModuleInit } from '@electrum/common'

export interface AppConfig {
  appName: string
  version: string
}

@Injectable()
export class ConfigService implements OnModuleInit {
  @Inject('APP_CONFIG')
  config!: AppConfig

  onModuleInit() {
    console.log(`[ConfigService] ${this.config.appName} v${this.config.version}`)
  }

  get appName() {
    return this.config.appName
  }

  get version() {
    return this.config.version
  }
}
