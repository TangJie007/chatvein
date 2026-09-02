import { describe, it, expect } from 'vitest'
import {
  Module,
  Injectable,
  Controller,
  WindowDeclaration,
} from '@electrum/common'
import { DIContainer } from '../di/container'
import { ModuleScanner } from '../module/scanner'

@Injectable()
class SharedService {
  value = 'shared'
}

@Module({
  providers: [SharedService],
})
class ChildModule {}

@WindowDeclaration({ name: 'main' })
class MainWindow {}

@Controller('child')
class ChildController {}

@Module({
  imports: [ChildModule],
  controllers: [ChildController],
  declarations: [MainWindow],
})
class RootModule {}

describe('ModuleScanner', () => {
  it('walks imports depth-first and registers providers/controllers', () => {
    const container = new DIContainer()
    const scanner = new ModuleScanner(container)
    const modules = scanner.scan(RootModule)

    expect(modules).toHaveLength(2)
    expect(modules[0].moduleClass).toBe(ChildModule)
    expect(modules[1].moduleClass).toBe(RootModule)
    expect(modules[1].controllers).toContain(ChildController)
    expect(modules[1].declarations).toContain(MainWindow)

    const shared = container.resolve(SharedService)
    expect(shared.value).toBe('shared')
  })

  it('deduplicates visited modules', () => {
    @Module({ imports: [ChildModule, ChildModule] })
    class DuplicateImportsModule {}

    const container = new DIContainer()
    const scanner = new ModuleScanner(container)
    const modules = scanner.scan(DuplicateImportsModule)

    expect(modules.filter((m) => m.moduleClass === ChildModule)).toHaveLength(1)
  })

  it('throws when module is missing @Module metadata', () => {
    class NotAModule {}

    const container = new DIContainer()
    const scanner = new ModuleScanner(container)

    expect(() => scanner.scan(NotAModule)).toThrow(/not decorated with @Module/)
  })

  it('registers useValue and useFactory providers', () => {
    @Module({
      providers: [
        { provide: 'CONFIG', useValue: { env: 'test' } },
        {
          provide: 'GREETING',
          useFactory: (config: { env: string }) => `hello-${config.env}`,
          inject: ['CONFIG'],
        },
      ],
    })
    class ConfigModule {}

    const container = new DIContainer()
    const scanner = new ModuleScanner(container)
    scanner.scan(ConfigModule)

    expect(container.resolve('GREETING')).toBe('hello-test')
  })
})
