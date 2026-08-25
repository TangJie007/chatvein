import { Module } from '@electrum/common'
import { WindowModule } from './window/window.module'
import { FileModule } from './file/file.module'
import { UserModule } from './user/user.module'
import { AppController } from './app.controller'
import { ConfigService } from './config.service'

@Module({
  imports: [WindowModule, FileModule, UserModule],
  controllers: [AppController],
  providers: [
    ConfigService,
    {
      provide: 'APP_CONFIG',
      useFactory: () => ({
        appName: 'Electrum Admin',
        version: '0.1.0',
      }),
    },
  ],
})
export class AppModule {}
