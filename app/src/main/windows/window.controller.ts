import { Controller, IpcHandle, WindowRef } from '@electrum/common'
import type { BrowserWindow } from 'electron'

/**
 * 窗口控制：无边框标题栏的三个交通灯按钮走这里。
 *
 * 窗口实例由 `@WindowRef('main')` 注入（WindowManager 在 IpcBridge 之前就绪），
 * Controller 自身不 new BrowserWindow，也不关心窗口是怎么声明出来的。
 */
@Controller('window')
export class WindowController {
  @WindowRef('main') private win?: BrowserWindow

  @IpcHandle('minimize')
  minimize(): void {
    this.win?.minimize()
  }

  /** 最大化 / 还原，返回切换后的最大化状态，供标题栏同步图标 */
  @IpcHandle('toggleMaximize')
  toggleMaximize(): boolean {
    if (!this.win) return false
    if (this.win.isMaximized()) this.win.unmaximize()
    else this.win.maximize()
    return this.win.isMaximized()
  }

  @IpcHandle('isMaximized')
  isMaximized(): boolean {
    return !!this.win?.isMaximized()
  }

  @IpcHandle('close')
  close(): void {
    this.win?.close()
  }

  @IpcHandle('list')
  list(): Array<{ id: number; title: string; focused: boolean }> {
    if (!this.win) return []
    return [{ id: this.win.id, title: this.win.getTitle(), focused: this.win.isFocused() }]
  }

  @IpcHandle('focus')
  focus(id: number): boolean {
    if (!this.win || this.win.id !== id) return false
    this.win.focus()
    return true
  }
}
