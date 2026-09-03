import { Module } from '@electrum/common'
import { SettingsController } from './settings.controller'
import { SettingsService } from './settings.service'
import { SettingsStore } from './settings.store'

@Module({
  controllers: [SettingsController],
  providers: [SettingsStore, SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
