import { Module } from '@electrum/common'
import { SettingsController } from './settings.controller'
import { SettingsService } from './settings.service'

@Module({
  controllers: [SettingsController],
  providers: [SettingsService],
})
export class SettingsModule {}
