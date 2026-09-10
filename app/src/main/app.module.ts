import { Module } from '@electrum/common'
import { AppController } from './app.controller'
import { AppService } from './app.service'
import { ChatModule } from './chat/chat.module'
import { SettingsModule } from './settings/settings.module'
import { WindowModule } from './windows/window.module'

/**
 * 根模块。
 *
 * 扫描顺序：imports 先于本模块（DFS），因此 WindowModule 声明的窗口会先被
 * WindowManager 收集；IPC 注册统一发生在建窗之后，@WindowRef 一定能取到实例。
 */
@Module({
  imports: [WindowModule, SettingsModule, ChatModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
