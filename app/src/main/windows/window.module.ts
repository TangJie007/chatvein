import { join } from 'node:path'
import { Module, WindowDeclaration } from '@electrum/common'
import { WindowController } from './window.controller'

/**
 * 主窗口：无边框 + 自绘标题栏（渲染端 TitleBar 组件负责三个交通灯按钮）。
 */
@WindowDeclaration({
  name: 'main',
  options: {
    width: 1180,
    height: 760,
    minWidth: 880,
    minHeight: 560,
    title: 'Chatvein',
    show: false,
    frame: false,
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
})
export class WindowModule {}
