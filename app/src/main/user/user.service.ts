import { Injectable, NotFoundException } from '@electrum/common'

export interface User {
  id: number
  name: string
  email: string
}

@Injectable()
export class UserService {
  private seq = 1
  private users = new Map<number, User>()

  constructor() {
    this.create({ name: 'Alice', email: 'alice@example.com' })
    this.create({ name: 'Bob', email: 'bob@example.com' })
  }

  list(): User[] {
    return [...this.users.values()]
  }

  get(id: number): User {
    const user = this.users.get(id)
    if (!user) throw new NotFoundException(`user:${id}`)
    return user
  }

  create(data: { name: string; email: string }): User {
    const user: User = { id: this.seq++, ...data }
    this.users.set(user.id, user)
    return user
  }

  update(id: number, data: Partial<Pick<User, 'name' | 'email'>>): User {
    const user = this.get(id)
    const next = { ...user, ...data }
    this.users.set(id, next)
    return next
  }

  remove(id: number): void {
    if (!this.users.delete(id)) {
      throw new NotFoundException(`user:${id}`)
    }
  }
}
