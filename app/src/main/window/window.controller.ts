import { Controller, IpcHandle, Inject } from '@electrum/common'
import { WindowService } from './window.service'
import { MenuService } from './menu.service'

@Controller('window')
export class WindowController {
  @Inject(WindowService)
  windows!: WindowService

  @Inject(MenuService)
  menu!: MenuService

  @IpcHandle('minimize')
  minimize(): void {
    this.windows.minimize(this.windows.getFocused())
  }

  @IpcHandle('toggleMaximize')
  toggleMaximize(): boolean {
    return this.windows.toggleMaximize(this.windows.getFocused())
  }

  @IpcHandle('isMaximized')
  isMaximized(): boolean {
    return this.windows.isMaximized(this.windows.getFocused())
  }

  @IpcHandle('close')
  close(): void {
    this.windows.close(this.windows.getFocused())
  }

  @IpcHandle('openChild')
  openChild(data?: { title?: string }): { id: number; title: string } {
    return this.windows.openChild({
      title: data?.title || '子窗口',
    })
  }

  @IpcHandle('list')
  list(): Array<{ id: number; title: string; focused: boolean }> {
    return this.windows.listWindows()
  }

  @IpcHandle('focus')
  focus(id: number): boolean {
    return this.windows.focus(id)
  }

  @IpcHandle('reloadMenu')
  reloadMenu(): { ok: true } {
    this.menu.apply()
    return { ok: true }
  }
}
