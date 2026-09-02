import { DIContainer } from '@electrum/core'

type Token = Function | string | symbol

/**
 * Lightweight DI wrapper for unit tests.
 * Supports register / mock / resolve without starting Electron.
 */
export class TestContainer {
  private container = new DIContainer()

  register(
    token: Token,
    provider: {
      useClass?: Function
      useValue?: unknown
      useFactory?: (...args: unknown[]) => unknown
      inject?: Token[]
      scope?: 'singleton' | 'transient'
    },
  ): this {
    this.container.register(token, provider as any)
    return this
  }

  resolve<T>(token: Token): T {
    return this.container.resolve<T>(token)
  }

  mock(token: Token, value: unknown): this {
    this.container.register(token, { useValue: value })
    return this
  }

  has(token: Token): boolean {
    return this.container.has(token)
  }

  clear(): void {
    this.container.clear()
  }

  /** Escape hatch for advanced tests */
  getContainer(): DIContainer {
    return this.container
  }
}

export function createTestContainer(): TestContainer {
  return new TestContainer()
}
