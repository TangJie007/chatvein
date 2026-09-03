import { reactive, ref } from 'vue'
import { createClient } from '@electrum/client'
import type { IpcApi, Conversation, ChatSendResult } from '../ipc-api'
import { toIpcPayload } from '../utils/toIpcPayload'

const api = createClient<IpcApi>()

const conversations = ref<Conversation[]>([])
const currentId = ref('')
const loading = ref(false)
const sending = ref(false)
const loaded = ref(false)
const error = ref('')

const current = () => conversations.value.find((c) => c.id === currentId.value) ?? null

async function refresh(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    conversations.value = await api.chat.list()
    loaded.value = true
    if (currentId.value && !conversations.value.some((c) => c.id === currentId.value)) {
      currentId.value = conversations.value[0]?.id ?? ''
    }
  } catch (e) {
    error.value = (e as Error)?.message ?? String(e)
  } finally {
    loading.value = false
  }
}

async function ensureActive(): Promise<Conversation> {
  if (!loaded.value) await refresh()
  let conv = current()
  if (conv) return conv
  if (conversations.value[0]) {
    currentId.value = conversations.value[0].id
    return conversations.value[0]
  }
  return create()
}

async function create(input?: { title?: string; agentId?: string }): Promise<Conversation> {
  const created = await api.chat.create(input ? toIpcPayload(input) : undefined)
  conversations.value = [created, ...conversations.value]
  currentId.value = created.id
  return created
}

async function select(id: string): Promise<Conversation | null> {
  currentId.value = id
  const local = conversations.value.find((c) => c.id === id)
  if (local) return local
  try {
    const remote = await api.chat.get(id)
    conversations.value = [remote, ...conversations.value.filter((c) => c.id !== id)]
    return remote
  } catch {
    return null
  }
}

async function remove(id: string): Promise<void> {
  await api.chat.remove(id)
  conversations.value = conversations.value.filter((c) => c.id !== id)
  if (currentId.value === id) {
    currentId.value = conversations.value[0]?.id ?? ''
  }
}

async function send(content: string): Promise<ChatSendResult> {
  const conv = await ensureActive()
  sending.value = true
  error.value = ''
  try {
    const result = await api.chat.send(
      toIpcPayload({ conversationId: conv.id, content, agentId: conv.agentId }),
    )
    conversations.value = [
      result.conversation,
      ...conversations.value.filter((c) => c.id !== result.conversation.id),
    ]
    currentId.value = result.conversation.id
    return result
  } catch (e) {
    error.value = (e as Error)?.message ?? String(e)
    throw e
  } finally {
    sending.value = false
  }
}

export function useChat() {
  return reactive({
    conversations,
    currentId,
    loading,
    sending,
    loaded,
    error,
    get current() {
      return current()
    },
    refresh,
    ensureActive,
    create,
    select,
    remove,
    send,
  })
}
