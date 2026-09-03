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
          { label: '对话', accelerator: 'CmdOrCtrl+1', click: () => this.navigate('/chat') },
          { label: 'Agents', accelerator: 'CmdOrCtrl+2', click: () => this.navigate('/agents') },
          { label: '模型选型', accelerator: 'CmdOrCtrl+3', click: () => this.navigate('/models') },
          { label: '群组', accelerator: 'CmdOrCtrl+4', click: () => this.navigate('/groups') },
          { label: '知识库', accelerator: 'CmdOrCtrl+5', click: () => this.navigate('/knowledge') },
          { label: 'MCP', accelerator: 'CmdOrCtrl+6', click: () => this.navigate('/mcp') },
          { label: 'Skills', accelerator: 'CmdOrCtrl+7', click: () => this.navigate('/skills') },
        ],
      },
      {
        label: '帮助',
        submenu: [
          {
            label: '关于 Chatvein Forge',
            click: () => {
              void dialog.showMessageBox({
                type: 'info',
                title: '关于',
                message: 'Chatvein Forge',
                detail:
                  '桌面 AI 工作台：多 Agent 协作、知识库、MCP 与 Skills 管理，运行在独立工作区沙箱中。',
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
