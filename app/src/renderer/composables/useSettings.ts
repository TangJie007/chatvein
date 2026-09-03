import { reactive, ref } from 'vue'
import { createClient } from '@electrum/client'
import type { IpcApi, AppSettingsView, AppSettingsPatch } from '../ipc-api'
import { toIpcPayload } from '../utils/toIpcPayload'

const api = createClient<IpcApi>()

const settings = ref<AppSettingsView | null>(null)
const loading = ref(false)
const loaded = ref(false)
const error = ref('')

async function refresh(): Promise<AppSettingsView> {
  loading.value = true
  error.value = ''
  try {
    const s = await api.settings.get()
    settings.value = s
    loaded.value = true
    return s
  } catch (e) {
    error.value = (e as Error)?.message ?? String(e)
    throw e
  } finally {
    loading.value = false
  }
}

async function update(patch: AppSettingsPatch): Promise<AppSettingsView> {
  const s = await api.settings.update(toIpcPayload(patch))
  settings.value = s
  return s
}

async function reset(): Promise<AppSettingsView> {
  const s = await api.settings.reset()
  settings.value = s
  return s
}

async function pickFolder(opts?: { title?: string; defaultPath?: string }): Promise<string | null> {
  return api.settings.pickFolder(opts ? toIpcPayload(opts) : undefined)
}

export function useSettings() {
  return reactive({
    settings,
    loading,
    loaded,
    error,
    refresh,
    update,
    reset,
    pickFolder,
  })
}
