import { DIContainer } from '@electrum/core'

export class TestContainer {
  private container = new DIContainer()

  register(token: any, provider: any): this {
    this.container.register(token, provider)
    return this
  }

  resolve<T>(token: any): T {
    return this.container.resolve<T>(token)
  }

  mock(token: any, value: any): this {
    this.container.register(token, { useValue: value })
    return this
  }
}

export function createTestContainer(): TestContainer {
  return new TestContainer()
}
