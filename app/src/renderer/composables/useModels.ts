import { reactive, ref } from 'vue'
import { createClient } from '@electrum/client'
import type { IpcApi, ModelConfig, ModelInput, ProviderPreset, ConnectionTestResult } from '../ipc-api'
import { toIpcPayload } from '../utils/toIpcPayload'

const api = createClient<IpcApi>()

const models = ref<ModelConfig[]>([])
const presets = ref<ProviderPreset[]>([])
const loading = ref(false)
const loaded = ref(false)
const error = ref('')

async function refresh(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const [list, p] = await Promise.all([api.model.list(), api.model.presets()])
    models.value = list
    presets.value = p
    loaded.value = true
  } catch (e) {
    error.value = (e as Error)?.message ?? String(e)
  } finally {
    loading.value = false
  }
}

async function create(input?: ModelInput): Promise<ModelConfig> {
  const created = await api.model.create(input ? toIpcPayload(input) : undefined)
  models.value = [created, ...models.value]
  return created
}

async function update(id: string, patch: ModelInput): Promise<ModelConfig> {
  const updated = await api.model.update(toIpcPayload({ id, patch }))
  models.value = models.value.map((m) => (m.id === id ? updated : m))
  return updated
}

async function remove(id: string): Promise<void> {
  await api.model.remove(id)
  models.value = models.value.filter((m) => m.id !== id)
}

async function testConnection(data: {
  baseUrl: string
  apiKey: string
  model: string
}): Promise<ConnectionTestResult> {
  return api.model.test(toIpcPayload(data))
}

function presetLabel(provider: string): string {
  return presets.value.find((p) => p.value === provider)?.label ?? provider
}

function findById(id: string): ModelConfig | undefined {
  return models.value.find((m) => m.id === id)
}

export function useModels() {
  return reactive({
    models,
    presets,
    loading,
    loaded,
    error,
    refresh,
    create,
    update,
    remove,
    testConnection,
    presetLabel,
    findById,
  })
}
