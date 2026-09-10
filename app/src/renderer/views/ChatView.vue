<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import { ipc } from '@/composables/useIpc'
import { ui } from '@/stores/ui'

type ChatHistory = Awaited<ReturnType<typeof ipc.chat.history>>

const messages = ref<ChatHistory>([])
const draft = ref('')
const sending = ref(false)
const scroller = ref<HTMLDivElement | null>(null)

async function scrollToBottom(): Promise<void> {
  await nextTick()
  const el = scroller.value
  if (el) el.scrollTop = el.scrollHeight
}

async function reload(): Promise<void> {
  messages.value = await ipc.chat.history()
  await scrollToBottom()
}

async function send(): Promise<void> {
  const text = draft.value.trim()
  if (!text || sending.value) return

  sending.value = true
  try {
    await ipc.chat.send(text)
    draft.value = ''
    await reload()
  } catch (err) {
    ui.notify(err instanceof Error ? err.message : '发送失败', 'error')
  } finally {
    sending.value = false
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    void send()
  }
}

async function clear(): Promise<void> {
  try {
    await ipc.chat.clear()
    await reload()
    ui.notify('已清空会话')
  } catch (err) {
    ui.notify(err instanceof Error ? err.message : '清空失败', 'error')
  }
}

onMounted(reload)
</script>

<template>
  <section class="flex h-full flex-col">
    <header class="flex items-center justify-between border-b border-line bg-surface px-5 py-3">
      <div>
        <h1 class="text-sm font-semibold">对话</h1>
        <p class="text-ink-soft text-xs">最小工作台 · 消息经 IPC 往返主进程</p>
      </div>
      <button
        class="text-ink-soft hover:bg-surface-2 hover:text-ink rounded-md border border-line px-3 py-1.5 text-xs transition-colors"
        @click="clear"
      >
        清空
      </button>
    </header>

    <div ref="scroller" class="flex-1 space-y-3 overflow-y-auto px-5 py-4">
      <p v-if="!messages.length" class="text-ink-soft mt-10 text-center text-sm">
        还没有消息，发送一条试试。
      </p>

      <div
        v-for="msg in messages"
        :key="msg.id"
        class="flex"
        :class="msg.role === 'user' ? 'justify-end' : 'justify-start'"
      >
        <div
          class="max-w-[72%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed shadow-panel"
          :class="msg.role === 'user' ? 'bg-brand text-white' : 'border border-line bg-surface text-ink'"
        >
          {{ msg.content }}
        </div>
      </div>
    </div>

    <footer class="border-t border-line bg-surface p-4">
      <div class="flex items-end gap-2">
        <textarea
          v-model="draft"
          rows="3"
          placeholder="输入消息，Enter 发送，Shift + Enter 换行"
          class="flex-1 resize-none rounded-xl border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand"
          @keydown="onKeydown"
        />
        <button
          class="bg-brand rounded-xl px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-50"
          :disabled="sending || !draft.trim()"
          @click="send"
        >
          {{ sending ? '发送中…' : '发送' }}
        </button>
      </div>
    </footer>
  </section>
</template>
