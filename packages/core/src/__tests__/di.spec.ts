import { describe, it, expect, vi } from 'vitest'
import {
  Injectable,
  Inject,
  Optional,
  WindowRef,
  Controller,
  IpcEmit,
} from '@electrum/common'
import { DIContainer } from '../di/container'

@Injectable()
class Logger {
  id = Math.random()
}

@Injectable()
class UserService {
  @Inject(Logger)
  logger!: Logger

  tag = 'users'
}

@Injectable({ scope: 'transient' })
class TransientService {
  id = Math.random()
}

@Controller({ prefix: 'demo', window: 'main' })
class EmitController {
  @IpcEmit('saved')
  saved!: (path: string) => void
}

describe('DIContainer', () => {
  it('resolves @Inject property injection', () => {
    const container = new DIContainer()
    container.register(Logger, { useClass: Logger })
    container.register(UserService, { useClass: UserService })

    const users = container.resolve(UserService)

    expect(users.logger).toBeInstanceOf(Logger)
    expect(users.tag).toBe('users')
  })

  it('returns the same singleton instance for repeated resolve', () => {
    const container = new DIContainer()
    container.register(Logger, { useClass: Logger })
    container.register(UserService, { useClass: UserService })

    const a = container.resolve(UserService)
    const b = container.resolve(UserService)
    const logger = container.resolve(Logger)

    expect(a).toBe(b)
    expect(a.logger).toBe(logger)
  })

  it('creates a new instance for transient scope', () => {
    const container = new DIContainer()
    container.register(TransientService, { useClass: TransientService, scope: 'transient' })

    const a = container.resolve(TransientService)
    const b = container.resolve(TransientService)

    expect(a).not.toBe(b)
    expect(a.id).not.toBe(b.id)
  })

  it('supports useValue and useFactory providers', () => {
    const container = new DIContainer()
    container.register('APP_NAME', { useValue: 'electrum' })
    container.register('BANNER', {
      useFactory: (name: string) => `[${name}]`,
      inject: ['APP_NAME'],
    })

    expect(container.resolve('BANNER')).toBe('[electrum]')
  })

  it('detects circular dependencies', () => {
    @Injectable()
    class A {
      @Inject('B')
      b!: unknown
    }
    @Injectable()
    class B {
      @Inject('A')
      a!: unknown
    }

    const container = new DIContainer()
    container.register('A', { useClass: A })
    container.register('B', { useClass: B })

    expect(() => container.resolve('A')).toThrow(/Circular dependency/)
  })

  it('skips @Optional injection when token is not registered', () => {
    @Injectable()
    class OptionalConsumer {
      @Optional()
      @Inject('MISSING')
      missing?: string
    }

    const container = new DIContainer()
    container.register(OptionalConsumer, { useClass: OptionalConsumer })

    const instance = container.resolve(OptionalConsumer)
    expect(instance.missing).toBeUndefined()
  })

  it('resolves @WindowRef from window provider', () => {
    @Injectable()
    class WindowConsumer {
      @WindowRef('main')
      mainWindow!: { id: number }
    }

    const fakeWindow = { id: 1 }
    const container = new DIContainer()
    container.setWindowProvider((name) => (name === 'main' ? fakeWindow : undefined))
    container.register(WindowConsumer, { useClass: WindowConsumer })

    const instance = container.resolve(WindowConsumer)
    expect(instance.mainWindow).toBe(fakeWindow)
  })

  it('injects @IpcEmit sender using controller prefix and window', () => {
    const sender = vi.fn()
    const container = new DIContainer()
    container.setWindowSender(sender)
    container.register(EmitController, { useClass: EmitController })

    const instance = container.resolve(EmitController)
    instance.saved('/tmp/a.txt')

    expect(sender).toHaveBeenCalledWith('main', 'demo:saved', '/tmp/a.txt')
  })
})
