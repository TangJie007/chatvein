<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import ConversationPane from './panes/ConversationPane.vue'
import ChatMessage from '../components/chat/ChatMessage.vue'
import Composer from '../components/chat/Composer.vue'
import ThinkingPanel from '../components/chat/ThinkingPanel.vue'
import AppIcon from '../components/AppIcon.vue'
import Avatar from '../components/ui/Avatar.vue'
import { useChat } from '../composables/useChat'
import { useAgents } from '../composables/useAgents'
import { useModels } from '../composables/useModels'
import { setCrumbItem } from '../composables/useUi'
import type { AvatarTint, Conversation } from '../ipc-api'

const chat = useChat()
const agents = useAgents()
const models = useModels()

const scroller = ref<HTMLElement | null>(null)
const status = ref('')

const mainAgent = computed(() => agents.agents.find((a) => a.isMain) ?? agents.agents[0])
const activeAgent = computed(() => {
  const id = chat.current?.agentId || mainAgent.value?.id
  return agents.agents.find((a) => a.id === id) ?? mainAgent.value
})
const activeModel = computed(() => {
  const id = activeAgent.value?.modelId
  return id ? models.findById(id) : undefined
})

const messages = computed(() => chat.current?.messages ?? [])

// 思考面板：仅展示当前会话的运行（事件带 conversationId，切会话时不串）
const panelActive = computed(
  () => chat.thinking.active && chat.thinking.conversationId === chat.currentId,
)
const panelThought = computed(() => (panelActive.value ? chat.thinking.text : ''))

function agentLabel(agentId: string): string {
  return agents.agents.find((a) => a.id === agentId)?.name ?? agentId
}
function agentInitial(agentId: string): string {
  return agents.agents.find((a) => a.id === agentId)?.initial ?? 'A'
}
function agentTint(agentId: string): AvatarTint {
  return agents.agents.find((a) => a.id === agentId)?.tint ?? 'indigo'
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function formatTokenLabel(m: { usage?: { promptTokens: number; completionTokens: number; totalTokens: number } }): string {
  const u = m.usage
  if (!u || u.totalTokens <= 0) return ''
  return `${formatCount(u.totalTokens)} tok`
}

function formatTokenTitle(m: { usage?: { promptTokens: number; completionTokens: number; totalTokens: number } }): string {
  const u = m.usage
  if (!u) return ''
  return `输入 ${formatCount(u.promptTokens)} · 输出 ${formatCount(u.completionTokens)} · 合计 ${formatCount(u.totalTokens)}`
}

function formatCount(n: number): string {
  return n.toLocaleString('en-US')
}

async function scrollBottom() {
  await nextTick()
  const el = scroller.value
  if (el) el.scrollTop = el.scrollHeight
}

function onSelect(c: Conversation) {
  void chat.select(c.id)
  setCrumbItem(c.title)
}

async function onAdd() {
  const created = await chat.create({ agentId: mainAgent.value?.id })
  setCrumbItem(created.title)
  status.value = '已新建对话'
  await scrollBottom()
}

async function onSend(text: string) {
  if (!activeModel.value) {
    status.value = '请先在 Agents 中绑定模型并填写 API Key'
    return
  }
  status.value = '生成中…'
  try {
    const result = await chat.send(text)
    status.value = `完成 · ${result.latencyMs} ms · ${result.model}`
    setCrumbItem(result.conversation.title)
    await scrollBottom()
  } catch (e) {
    status.value = (e as Error).message || '发送失败'
  }
}

watch(
  () => messages.value.length,
  () => {
    void scrollBottom()
  },
)

onMounted(async () => {
  await Promise.all([
    agents.loaded ? Promise.resolve() : agents.refresh(),
    models.loaded ? Promise.resolve() : models.refresh(),
    chat.loaded ? Promise.resolve() : chat.refresh(),
  ])
  if (!chat.conversations.length) {
    await chat.create({ agentId: mainAgent.value?.id })
  } else if (!chat.currentId) {
    await chat.select(chat.conversations[0].id)
  }
  const cur = chat.current
  setCrumbItem(cur?.title || '对话')
  await scrollBottom()
})
</script>

<template>
  <ConversationPane
    :conversations="chat.conversations"
    :model-value="chat.currentId"
    :loading="chat.loading"
    :agent-label="agentLabel"
    :agent-initial="agentInitial"
    :agent-tint="agentTint"
    @select="onSelect"
    @add="onAdd"
  />

  <main
    class="relative grid min-h-0 min-w-0 overflow-hidden"
    style="
      grid-template-columns: minmax(0, 1fr) auto;
      background:
        radial-gradient(80% 40% at 50% 0%, rgb(254 254 254 / 0.85), transparent 70%),
        var(--color-canvas);
    "
  >
    <section class="grid h-full min-h-0" style="grid-template-rows: auto 1fr auto">
      <header class="flex items-center justify-between gap-4 px-[26px] pb-3 pt-4">
        <div class="flex min-w-0 items-center gap-3">
          <Avatar
            :initial="activeAgent?.initial || 'A'"
            :tint="activeAgent?.tint || 'indigo'"
            size="lg"
            :dot="chat.sending ? 'thinking' : activeAgent?.enabled ? 'online' : 'idle'"
          />
          <div class="min-w-0">
            <div class="truncate font-serif text-[22px] leading-[1.15] tracking-[0.2px] text-[var(--color-ink-1)]">
              {{ activeAgent?.name || '未配置 Agent' }} ·
              <em class="italic" style="color: var(--color-brand-deep)">{{ activeAgent?.role || '—' }}</em>
            </div>
            <div class="mt-[3px] flex flex-wrap items-center gap-2">
              <span
                class="rounded-full bg-[var(--color-brand-soft)] px-2.5 py-[3px] font-mono text-[11px] font-medium text-[var(--color-brand-dark)]"
              >
                {{ chat.current?.title || '新对话' }}
              </span>
              <span class="font-mono text-[11px] text-[var(--color-ink-3)]">
                {{ activeModel ? `${activeModel.name} · ${activeModel.model}` : '未绑定模型' }}
              </span>
            </div>
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-2 text-xs font-medium text-[var(--color-ink-2)]">
          <template v-if="chat.sending">
            <span class="h-[7px] w-[7px] rounded-full bg-[var(--color-brand)] dot-thinking" />
            正在生成…
          </template>
          <template v-else-if="status">
            <span class="max-w-[280px] truncate font-mono text-[11px] text-[var(--color-ink-3)]">{{ status }}</span>
          </template>
        </div>
      </header>

      <div
        ref="scroller"
        class="scroll-thin flex min-h-0 flex-col gap-[13px] overflow-y-auto px-[26px] pb-4 pt-2.5"
        aria-live="polite"
      >
        <div
          v-if="!messages.length && !chat.sending"
          class="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-center"
        >
          <div
            class="grid h-12 w-12 place-items-center rounded-[16px] text-[var(--color-brand-deep)]"
            style="background: linear-gradient(180deg, var(--color-brand-mist), rgb(233 236 249 / 0.55))"
          >
            <AppIcon name="chat" :size="22" />
          </div>
          <div class="font-serif text-lg text-[var(--color-ink-1)]">开始对话</div>
          <p class="max-w-sm text-xs leading-relaxed text-[var(--color-ink-3)]">
            消息将发送给「{{ activeAgent?.name || '主对话 Agent' }}」。
            <template v-if="!activeModel">请先在 Agents 中为该角色绑定模型并填写 API Key。</template>
          </p>
        </div>

        <ChatMessage
          v-for="m in messages"
          :key="m.id"
          :role="m.role === 'assistant' ? 'agent' : 'user'"
          :initial="m.role === 'assistant' ? activeAgent?.initial || 'A' : '我'"
          :tint="m.role === 'assistant' ? activeAgent?.tint || 'indigo' : 'sky'"
          :author="m.role === 'assistant' ? activeAgent?.name : undefined"
          :role-mini="m.role === 'assistant' ? activeAgent?.role : undefined"
          :time="formatTime(m.createdAt)"
          :content="m.content"
          :token-label="m.role === 'assistant' ? formatTokenLabel(m) : ''"
          :token-title="m.role === 'assistant' ? formatTokenTitle(m) : ''"
        />

        <div
          v-if="chat.sending"
          class="flex items-center gap-2 px-1 text-xs text-[var(--color-ink-3)]"
        >
          <span class="h-[7px] w-[7px] rounded-full bg-[var(--color-brand)] dot-thinking" />
          {{ activeAgent?.name || 'Agent' }} 正在回复…
        </div>
      </div>

      <Composer
        :placeholder="`跟 ${activeAgent?.name || 'Agent'} 说点什么…`"
        :scope-label="activeModel ? activeModel.model : '未绑定模型'"
        :send-label="chat.sending ? '生成中' : '发送'"
        hint="Enter 发送 · Shift+Enter 换行"
        :disabled="chat.sending"
        @send="onSend"
      >
        <template #tools>
          <span class="px-1 font-mono text-[11px] text-[var(--color-ink-3)]">一期 · 纯对话</span>
        </template>
        <template #footer-left>
          <span>· {{ activeAgent?.name || '—' }}</span>
        </template>
        <template #statbar>
          <span class="inline-flex items-center gap-1.5 before:h-[5px] before:w-[5px] before:rounded-full before:bg-[var(--color-brand)] before:content-['']">
            {{ activeModel?.name || '未配置模型' }}
          </span>
          <span class="inline-flex items-center gap-1.5 before:h-[5px] before:w-[5px] before:rounded-full before:bg-[var(--color-ok)] before:content-['']">
            历史 {{ messages.length }} 条
          </span>
        </template>
      </Composer>
    </section>

    <!-- AI 实时思考侧栏：reasoning 经 chat:event 流式推送 -->
    <ThinkingPanel
      :active="panelActive"
      :phase="chat.thinking.phase"
      :agent="chat.thinking.agent"
      :thought="panelThought"
    />
  </main>
</template>
