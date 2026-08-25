import { Module, WindowDeclaration } from '@electrum/common'
import { join } from 'node:path'
import { WindowController } from './window.controller'
import { WindowService } from './window.service'
import { MenuService } from './menu.service'

@WindowDeclaration({
  name: 'main',
  options: {
    width: 1180,
    height: 760,
    minWidth: 880,
    minHeight: 560,
    title: 'Electrum Admin',
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#f5f7fa',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  },
  prodFile: join(__dirname, '../renderer/index.html'),
})
export class MainWindow {}

@Module({
  declarations: [MainWindow],
  controllers: [WindowController],
  providers: [WindowService, MenuService],
})
export class WindowModule {}
