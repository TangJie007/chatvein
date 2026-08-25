import {
  Injectable,
  Inject,
  OnModuleInit,
  OnModuleDestroy,
  NotFoundException,
} from '@electrum/common'
import { promises as fs } from 'node:fs'
import { watch, type FSWatcher } from 'node:fs'
import type { AppConfig } from '../config.service'

@Injectable()
export class FileService implements OnModuleInit, OnModuleDestroy {
  @Inject('APP_CONFIG')
  config!: AppConfig

  private watchers = new Map<string, FSWatcher>()

  onModuleInit() {
    console.log(`[FileService] ready (app=${this.config.appName})`)
  }

  async read(filePath: string): Promise<string> {
    try {
      return await fs.readFile(filePath, 'utf-8')
    } catch {
      throw new NotFoundException(filePath)
    }
  }

  async write(filePath: string, content: string): Promise<void> {
    await fs.writeFile(filePath, content, 'utf-8')
  }

  watch(filePath: string, callback: (change: { event: string; filename: string | null }) => void) {
    if (this.watchers.has(filePath)) return
    const watcher = watch(filePath, (event, filename) => {
      callback({ event, filename })
    })
    this.watchers.set(filePath, watcher)
  }

  closeAllWatchers() {
    for (const watcher of this.watchers.values()) watcher.close()
    this.watchers.clear()
  }

  onModuleDestroy() {
    this.closeAllWatchers()
  }
}
