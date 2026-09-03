import { reactive, ref } from 'vue'
import { createClient } from '@electrum/client'
import type { IpcApi, AgentConfig, AgentInput } from '../ipc-api'

const api = createClient<IpcApi>()

// 模块级单例：AgentsView 与列表侧栏共享同一份配置状态
const agents = ref<AgentConfig[]>([])
const loading = ref(false)
const loaded = ref(false)
const error = ref('')

async function refresh(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    agents.value = await api.agent.list()
    loaded.value = true
  } catch (e) {
    error.value = (e as Error)?.message ?? String(e)
  } finally {
    loading.value = false
  }
}

async function create(input?: AgentInput): Promise<AgentConfig> {
  const created = await api.agent.create(input)
  agents.value = [...agents.value, created]
  return created
}

async function update(id: string, patch: AgentInput): Promise<AgentConfig> {
  const updated = await api.agent.update({ id, patch })
  agents.value = agents.value.map((a) => (a.id === id ? updated : a))
  return updated
}

async function remove(id: string): Promise<void> {
  await api.agent.remove(id)
  agents.value = agents.value.filter((a) => a.id !== id)
}

export function useAgents() {
  return reactive({
    agents,
    loading,
    loaded,
    error,
    refresh,
    create,
    update,
    remove,
  })
}
