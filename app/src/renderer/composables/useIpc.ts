import { createClient } from '@electrum/client'
import type { IpcApi } from '@/api/ipc-api'

/**
 * 类型化 IPC 客户端单例。
 *
 * `ipc.chat.send(text)` → `invoke('chat:send', text)`；
 * `ipc.window.minimize()` → `invoke('window:minimize')`。
 * 类型由 @electrum/codegen 从主进程 Controller 生成。
 */
export const ipc = createClient<IpcApi>()
