import { reactive, ref } from 'vue'
import { createClient } from '@electrum/client'
import type { IpcApi, Conversation, ChatSendResult, ChatStreamEvent } from '../ipc-api'
import { toIpcPayload } from '../utils/toIpcPayload'

const api = createClient<IpcApi>()

const conversations = ref<Conversation[]>([])
const currentId = ref('')
const loading = ref(false)
const sending = ref(false)
const loaded = ref(false)
const error = ref('')

/**
 * 当前运行的思考过程状态（由主进程 `chat:event` 事件驱动）。
 * - active：本轮是否在进行中（思考 / 出正文期间面板都挂着）
 * - phase：'thinking' 推理流式中（live 指示）→ 'answering' 思考结束、正在出正文
 */
const thinking = reactive({
  active: false,
  phase: 'thinking' as 'thinking' | 'answering',
  runId: '',
  conversationId: '',
  agent: '',
  text: '',
})

// 模块级订阅一次：主进程 → 渲染进程的对话流事件
api.on('chat:event', (evt: unknown) => {
  const e = evt as ChatStreamEvent
  if (!e || typeof e !== 'object' || !('type' in e)) return
  switch (e.type) {
    case 'run_start':
      thinking.active = true
      thinking.phase = 'thinking'
      thinking.runId = e.runId
      thinking.conversationId = e.conversationId
      thinking.agent = e.agent
      thinking.text = ''
      break
    case 'thinking_delta':
      if (e.runId === thinking.runId) thinking.text += e.delta
      break
    case 'thinking_done':
      if (e.runId === thinking.runId) thinking.phase = 'answering'
      break
  }
})

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
    // 本轮结束（成功或失败）：收起思考面板
    thinking.active = false
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
    thinking,
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
