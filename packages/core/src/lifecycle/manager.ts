import { Logger } from '@electrum/common'
import type { ScannedModule } from '../module/scanner'
import type { DIContainer } from '../di/container'

export class LifecycleManager {
  private logger = new Logger('Lifecycle')

  constructor(
    private container: DIContainer,
    private scannedModules: ScannedModule[],
  ) {}

  async runHook(hook: 'onModuleInit' | 'onAppReady' | 'onModuleDestroy'): Promise<void> {
    const instances: any[] = []

    for (const mod of this.scannedModules) {
      for (const cls of [...mod.controllers, ...mod.providers]) {
        if (this.container.has(cls)) {
          const instance = this.container.resolve(cls)
          if (typeof instance[hook] === 'function') {
            instances.push(instance)
          }
        }
      }
    }

    const results = await Promise.allSettled(
      instances.map((inst) => Promise.resolve(inst[hook]())),
    )

    for (let i = 0; i < results.length; i++) {
      const result = results[i]
      if (result.status === 'rejected') {
        this.logger.error(
          `${hook} failed for ${instances[i].constructor.name}: ${result.reason}`,
        )
      }
    }
  }
}
