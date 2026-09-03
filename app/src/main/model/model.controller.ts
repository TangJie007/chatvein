import { Controller, IpcHandle, Inject } from '@electrum/common'
import { ModelService, type ModelInput } from './model.service'
import type { ConnectionTestResult, ModelConfig, ProviderPreset } from './model.types'

@Controller('model')
export class ModelController {
  @Inject(ModelService)
  models!: ModelService

  @IpcHandle('list')
  list(): Promise<ModelConfig[]> {
    return this.models.list()
  }

  @IpcHandle('get')
  get(id: string): Promise<ModelConfig> {
    return this.models.get(id)
  }

  @IpcHandle('create')
  create(input?: ModelInput): Promise<ModelConfig> {
    return this.models.create(input ?? {})
  }

  @IpcHandle('update')
  update(data: { id: string; patch: ModelInput }): Promise<ModelConfig> {
    return this.models.update(data.id, data.patch)
  }

  @IpcHandle('remove')
  remove(id: string): Promise<{ ok: true }> {
    return this.models.remove(id)
  }

  @IpcHandle('presets')
  presets(): ProviderPreset[] {
    return this.models.listPresets()
  }

  @IpcHandle('test')
  test(data: { baseUrl: string; apiKey: string; model: string }): Promise<ConnectionTestResult> {
    return this.models.testConnection(data)
  }
}
