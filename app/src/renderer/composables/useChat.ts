import { reactive, ref } from 'vue'
import { createClient } from '@electrum/client'
import type { IpcApi, Conversation, ChatSendResult, ChatStreamEvent, ChatMessage, ChatArtifactItem } from '../ipc-api'
import { toIpcPayload } from '../utils/toIpcPayload'

const api = createClient<IpcApi>()

const conversations = ref<Conversation[]>([])
const currentId = ref('')
const loading = ref(false)
const sending = ref(false)
const loaded = ref(false)
const error = ref('')
/** 当前会话产物（磁盘回填 / 本轮 artifacts 事件） */
const artifacts = ref<ChatArtifactItem[]>([])
/** 侧栏正在展示的思考流对应的助手消息 id（点击气泡 / 本轮结束后） */
const selectedThinkingMessageId = ref('')

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
      artifacts.value = []
      selectedThinkingMessageId.value = ''
      break
    case 'thinking_delta':
      if (e.runId === thinking.runId) thinking.text += e.delta
      break
    case 'thinking_done':
      if (e.runId === thinking.runId) thinking.phase = 'answering'
      break
    case 'artifacts':
      if (e.runId === thinking.runId) artifacts.value = e.items
      break
    case 'route':
      // 路由详情已写入 thinking_delta；此处预留 UI 结构化消费
      break
    case 'llm_debug':
      // 开发环境：渲染进程 DevTools；payload 可能已是 JSON 字符串
      {
        const raw = e.payload
        let body: unknown = raw
        if (typeof raw === 'string') {
          try {
            body = JSON.parse(raw) as unknown
          } catch {
            body = raw
          }
        }
        console.log(`[chatvein:llm:${e.source}]`, body)
      }
      break
  }
})

const current = () => conversations.value.find((c) => c.id === currentId.value) ?? null

function patchConversation(id: string, patch: (c: Conversation) => Conversation): void {
  conversations.value = conversations.value.map((c) => (c.id === id ? patch(c) : c))
}

function applySendResult(result: ChatSendResult): void {
  conversations.value = [
    result.conversation,
    ...conversations.value.filter((c) => c.id !== result.conversation.id),
  ]
  currentId.value = result.conversation.id
  // 本轮结束后侧栏继续展示该回复的思考流
  selectedThinkingMessageId.value = result.assistantMessage.id
  thinking.conversationId = result.conversation.id
}

async function selectThinking(messageId: string): Promise<void> {
  const conv = current()
  if (!conv || !messageId) return
  if (thinking.active) return
  try {
    const { text } = await api.chat.getThinkingLog(
      toIpcPayload({ conversationId: conv.id, messageId }),
    )
    selectedThinkingMessageId.value = messageId
    thinking.conversationId = conv.id
    thinking.phase = 'answering'
    thinking.text =
      text != null && text.trim()
        ? text
        : '（该回复没有保存思考流日志，可能是旧消息或落盘失败）'
  } catch (e) {
    console.warn('[chat] getThinkingLog failed', e)
    selectedThinkingMessageId.value = messageId
    thinking.text = '（读取思考流失败）'
  }
}

async function refresh(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    conversations.value = await api.chat.list()
    loaded.value = true
    if (currentId.value && !conversations.value.some((c) => c.id === currentId.value)) {
      currentId.value = conversations.value[0]?.id ?? ''
    }
    if (currentId.value) void refreshArtifacts(currentId.value)
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
  artifacts.value = []
  selectedThinkingMessageId.value = ''
  thinking.text = ''
  return created
}

async function select(id: string): Promise<Conversation | null> {
  currentId.value = id
  selectedThinkingMessageId.value = ''
  if (!thinking.active) thinking.text = ''
  const local = conversations.value.find((c) => c.id === id)
  if (local) {
    void refreshArtifacts(id)
    return local
  }
  try {
    const remote = await api.chat.get(id)
    conversations.value = [remote, ...conversations.value.filter((c) => c.id !== id)]
    void refreshArtifacts(id)
    return remote
  } catch {
    return null
  }
}

/** 从磁盘回填产物（切会话 / 发送后兜底） */
async function refreshArtifacts(conversationId: string): Promise<void> {
  if (!conversationId) return
  // 运行中以事件为准，避免覆盖本轮增量
  if (thinking.active && thinking.conversationId === conversationId) return
  try {
    const items = await api.chat.listArtifacts(conversationId)
    if (currentId.value !== conversationId) return
    if (thinking.active && thinking.conversationId === conversationId) return
    artifacts.value = Array.isArray(items) ? items : []
  } catch (e) {
    console.warn('[chat] listArtifacts failed', e)
  }
}

/** 本地列表移除已删除产物（磁盘删除由 IPC 完成） */
function dropArtifact(artifactId: string): void {
  artifacts.value = artifacts.value.filter((a) => a.id !== artifactId)
}

async function remove(id: string): Promise<void> {
  await api.chat.remove(id)
  conversations.value = conversations.value.filter((c) => c.id !== id)
  if (currentId.value === id) {
    currentId.value = conversations.value[0]?.id ?? ''
  }
}

function localFailureMessage(reason: string): ChatMessage {
  return {
    id: `local-fail-${Date.now()}`,
    role: 'assistant',
    content: `抱歉，这次没能完成回复。\n\n原因：${reason}\n\n你可以点击「重试」，或稍后再试。`,
    createdAt: Date.now(),
    failed: true,
  }
}

async function send(content: string): Promise<ChatSendResult> {
  const conv = await ensureActive()
  const text = content.trim()
  if (!text) throw new Error('消息不能为空')

  sending.value = true
  error.value = ''

  // 乐观插入用户气泡；失败也不撤回（用户未主动删除）
  const optimisticId = `pending-${Date.now()}`
  const optimisticMsg: ChatMessage = {
    id: optimisticId,
    role: 'user',
    content: text,
    createdAt: Date.now(),
  }
  patchConversation(conv.id, (c) => ({
    ...c,
    messages: [...c.messages, optimisticMsg],
    updatedAt: Date.now(),
  }))

  try {
    const result = await api.chat.send(
      toIpcPayload({ conversationId: conv.id, content: text, agentId: conv.agentId }),
    )
    applySendResult(result)
    return result
  } catch (e) {
    // 发送前校验失败等：保留用户气泡，追加友好失败提示
    const reason = (e as Error)?.message ?? String(e)
    error.value = reason
    patchConversation(conv.id, (c) => ({
      ...c,
      messages: [...c.messages, localFailureMessage(reason)],
      updatedAt: Date.now(),
    }))
    throw e
  } finally {
    sending.value = false
    thinking.active = false
    void refreshArtifacts(conv.id)
  }
}
async function retry(failedMessageId: string): Promise<ChatSendResult> {
  const conv = current()
  if (!conv) throw new Error('没有当前会话')

  const failed = conv.messages.find((m) => m.id === failedMessageId)
  if (!failed?.failed) throw new Error('只能重试失败的回复')

  sending.value = true
  error.value = ''

  // 本地先去掉失败气泡，显示「正在回复」
  patchConversation(conv.id, (c) => ({
    ...c,
    messages: c.messages.filter((m) => m.id !== failedMessageId),
    updatedAt: Date.now(),
  }))

  try {
    // 已落库的失败消息走主进程 retry；本地占位则用末条用户内容再 send
    const isLocalFail = failedMessageId.startsWith('local-fail-')
    let result: ChatSendResult
    if (isLocalFail) {
      const lastUser = [...(current()?.messages ?? [])].reverse().find((m) => m.role === 'user')
      if (!lastUser) throw new Error('找不到对应的用户消息')
      result = await api.chat.send(
        toIpcPayload({
          conversationId: conv.id,
          content: lastUser.content,
          agentId: conv.agentId,
        }),
      )
      // send 会再写一条用户消息；合并去重视图由服务端会话覆盖
      applySendResult(result)
    } else {
      result = await api.chat.retry(
        toIpcPayload({ conversationId: conv.id, failedMessageId }),
      )
      applySendResult(result)
    }
    return result
  } catch (e) {
    const reason = (e as Error)?.message ?? String(e)
    error.value = reason
    patchConversation(conv.id, (c) => ({
      ...c,
      messages: [...c.messages, localFailureMessage(reason)],
      updatedAt: Date.now(),
    }))
    throw e
  } finally {
    sending.value = false
    thinking.active = false
    void refreshArtifacts(conv.id)
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
    artifacts,
    selectedThinkingMessageId,
    get current() {
      return current()
    },
    refresh,
    refreshArtifacts,
    dropArtifact,
    selectThinking,
    ensureActive,
    create,
    select,
    remove,
    send,
    retry,
  })
}
