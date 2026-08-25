import {
  BrowserWindow,
  Menu,
  dialog,
  type MenuItemConstructorOptions,
} from 'electron'
import { Injectable, Inject, Logger, type OnAppReady } from '@electrum/common'
import { WindowService } from './window.service'

@Injectable()
export class MenuService implements OnAppReady {
  private logger = new Logger('MenuService')

  @Inject(WindowService)
  windows!: WindowService

  onAppReady(): void {
    this.apply()
    this.logger.log('Application menu ready')
  }

  apply(): void {
    const template: MenuItemConstructorOptions[] = [
      {
        label: '文件',
        submenu: [
          {
            label: '新建子窗口',
            accelerator: 'CmdOrCtrl+N',
            click: () => {
              this.windows.openChild({ title: '菜单新建窗口' })
            },
          },
          { type: 'separator' },
          {
            label: '退出',
            role: process.platform === 'darwin' ? 'quit' : undefined,
            accelerator: process.platform === 'darwin' ? undefined : 'Alt+F4',
            click:
              process.platform === 'darwin'
                ? undefined
                : () => {
                    BrowserWindow.getFocusedWindow()?.close()
                  },
          },
        ],
      },
      {
        label: '窗口',
        submenu: [
          {
            label: '最小化',
            accelerator: 'CmdOrCtrl+M',
            click: () => this.windows.minimize(this.windows.getFocused()),
          },
          {
            label: '最大化 / 还原',
            click: () => this.windows.toggleMaximize(this.windows.getFocused()),
          },
          { type: 'separator' },
          {
            label: '关闭窗口',
            accelerator: 'CmdOrCtrl+W',
            click: () => this.windows.close(this.windows.getFocused()),
          },
        ],
      },
      {
        label: '导航',
        submenu: [
          {
            label: '工作台',
            accelerator: 'CmdOrCtrl+1',
            click: () => this.navigate('dashboard'),
          },
          {
            label: '用户管理',
            accelerator: 'CmdOrCtrl+2',
            click: () => this.navigate('users'),
          },
          {
            label: '文件读写',
            accelerator: 'CmdOrCtrl+3',
            click: () => this.navigate('files'),
          },
          {
            label: '窗口与菜单',
            accelerator: 'CmdOrCtrl+4',
            click: () => this.navigate('windows'),
          },
        ],
      },
      {
        label: '帮助',
        submenu: [
          {
            label: '关于 Electrum Demo',
            click: () => {
              void dialog.showMessageBox({
                type: 'info',
                title: '关于',
                message: 'Electrum Admin',
                detail:
                  'Nest 风格 Electron MVC 示例：无边框窗口、自定义菜单、多窗口与 Element Plus 管理端。',
              })
            },
          },
          {
            label: '切换开发者工具',
            accelerator: 'CmdOrCtrl+Shift+I',
            click: () => {
              const win = this.windows.getFocused()
              win?.webContents.toggleDevTools()
            },
          },
        ],
      },
    ]

    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  }

  private navigate(view: string): void {
    const win = this.windows.getFocused()
    if (win && !win.isDestroyed()) {
      win.webContents.send('menu:navigate', view)
      return
    }
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send('menu:navigate', view)
    }
  }
}
