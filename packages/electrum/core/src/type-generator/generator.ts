import * as fs from 'node:fs'
import * as path from 'node:path'
import { META, readMetadata, type IpcHandlerEntry } from '@electrum/common'
import type { ScannedModule } from '../module/scanner'

export class TypeGenerator {
  constructor(private scannedModules: ScannedModule[]) {}

  generate(outputPath: string): void {
    const channels: Array<{ channel: string; params: string; returnType: string }> = []

    for (const mod of this.scannedModules) {
      for (const controllerClass of mod.controllers) {
        const controllerMeta = readMetadata<{ prefix: string }>(controllerClass, META.CONTROLLER)
        const prefix = controllerMeta?.prefix || ''

        const handleMethods =
          readMetadata<IpcHandlerEntry[]>(controllerClass, META.IPC_HANDLE) || []

        for (const { channel } of handleMethods) {
          const fullChannel = prefix ? `${prefix}:${channel}` : channel
          channels.push({
            channel: fullChannel,
            params: '...args: any[]',
            returnType: 'any',
          })
        }
      }
    }

    const dir = path.dirname(outputPath)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(outputPath, this.buildDeclaration(channels), 'utf-8')
  }

  private buildDeclaration(
    channels: Array<{ channel: string; params: string; returnType: string }>,
  ): string {
    const methods = channels
      .map(
        (c) =>
          `  /** IPC channel: ${c.channel} */\n  '${c.channel}': (${c.params}) => Promise<${c.returnType}>`,
      )
      .join('\n\n')

    return `// AUTO-GENERATED — DO NOT EDIT
export interface IpcApi {
${methods}
}

export interface ElectronAPI {
  invoke: <K extends keyof IpcApi>(channel: K, ...args: Parameters<IpcApi[K]>) => ReturnType<IpcApi[K]>
  on: (channel: string, listener: (...args: any[]) => void) => void
  send: (channel: string, ...args: any[]) => void
}

declare global {
  interface Window { api: ElectronAPI }
}

export {}
`
  }
}
