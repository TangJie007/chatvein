import { Controller, IpcHandle, Inject } from '@electrum/common'
import { UserService, type User } from './user.service'

@Controller('user')
export class UserController {
  @Inject(UserService)
  users!: UserService

  @IpcHandle('list')
  list(): User[] {
    return this.users.list()
  }

  @IpcHandle('get')
  get(id: number): User {
    return this.users.get(id)
  }

  @IpcHandle('create')
  create(data: { name: string; email: string }): User {
    return this.users.create(data)
  }

  @IpcHandle('update')
  update(data: { id: number; name?: string; email?: string }): User {
    const { id, ...patch } = data
    return this.users.update(id, patch)
  }

  @IpcHandle('remove')
  remove(id: number): { ok: true } {
    this.users.remove(id)
    return { ok: true }
  }
}
