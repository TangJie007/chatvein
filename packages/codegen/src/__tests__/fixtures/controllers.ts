import { Controller, IpcHandle } from './stubs'
import type { User } from './user.service'

@Controller('user')
export class UserController {
  @IpcHandle('list')
  list(): User[] {
    return []
  }

  @IpcHandle('get')
  get(id: number): User {
    return { id, name: '', email: '' }
  }

  @IpcHandle('create')
  create(data: { name: string; email: string }): User {
    return { id: 1, ...data }
  }

  @IpcHandle('remove')
  remove(id: number): { ok: true } {
    return { ok: true }
  }

  @IpcHandle('debug', { devOnly: true })
  debug(): string {
    return 'debug'
  }
}

@Controller({ prefix: 'file', window: 'main' })
export class FileController {
  @IpcHandle('read')
  async read(filePath: string): Promise<string> {
    return filePath
  }

  @IpcHandle('write')
  write(data: { path: string; content: string }): Promise<{ ok: true; path: string }> {
    return Promise.resolve({ ok: true, path: data.path })
  }
}
