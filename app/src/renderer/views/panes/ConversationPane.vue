<script setup lang="ts">
import { computed, ref } from 'vue'
import ListPane from '../../components/layout/ListPane.vue'
import ListRow from '../../components/list/ListRow.vue'
import SectionLabel from '../../components/list/SectionLabel.vue'
import HintCard from '../../components/list/HintCard.vue'
import Avatar from '../../components/ui/Avatar.vue'
import AppIcon from '../../components/AppIcon.vue'
import type { Conversation } from '../../ipc-api'
import type { AvatarTint } from '../../ipc-api'

const props = defineProps<{
  conversations: Conversation[]
  modelValue?: string
  loading?: boolean
  agentLabel?: (agentId: string) => string
  agentInitial?: (agentId: string) => string
  agentTint?: (agentId: string) => AvatarTint
}>()

const emit = defineEmits<{
  'update:modelValue': [string]
  select: [Conversation]
  add: []
}>()

const query = ref('')
const q = computed(() => query.value.trim().toLowerCase())

const filtered = computed(() =>
  props.conversations.filter((c) => {
    if (!q.value) return true
    const last = c.messages[c.messages.length - 1]?.content ?? ''
    return [c.title, last].some((s) => s.toLowerCase().includes(q.value))
  }),
)

function preview(c: Conversation): string {
  const last = c.messages[c.messages.length - 1]
  if (!last) return '暂无消息'
  const prefix = last.role === 'user' ? '我: ' : ''
  const text = last.content.replace(/\s+/g, ' ').trim()
  return prefix + (text.length > 40 ? `${text.slice(0, 40)}…` : text)
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  if (sameDay) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  return `${d.getMonth() + 1}/${d.getDate()}`
}

function pick(c: Conversation) {
  emit('update:modelValue', c.id)
  emit('select', c)
}
</script>

<template>
  <ListPane
    v-model="query"
    title="对话"
    :count="String(conversations.length).padStart(2, '0')"
    search-placeholder="搜索会话…"
    @add="emit('add')"
  >
    <div v-if="loading" class="px-2 py-6 text-center text-xs text-[var(--color-ink-3)]">加载会话…</div>

    <template v-else>
      <SectionLabel v-if="filtered.length" title="最近会话" />
      <ListRow
        v-for="c in filtered"
        :key="c.id"
        :active="modelValue === c.id"
        @click="pick(c)"
      >
        <template #leading>
          <Avatar
            :initial="agentInitial?.(c.agentId) || 'A'"
            :tint="agentTint?.(c.agentId) || 'indigo'"
            :dot="modelValue === c.id ? 'thinking' : 'idle'"
          />
        </template>
        <template #body>
          <div class="truncate text-[13px] font-semibold text-[var(--color-ink-1)]">{{ c.title }}</div>
          <div class="mt-0.5 max-w-[196px] truncate text-xs text-[var(--color-ink-2)]">
            {{ agentLabel?.(c.agentId) || c.agentId }} · {{ preview(c) }}
          </div>
        </template>
        <template #meta>
          <span class="whitespace-nowrap font-mono text-[10.5px] font-medium text-[var(--color-ink-3)]">
            {{ formatTime(c.updatedAt) }}
          </span>
        </template>
      </ListRow>

      <div
        v-if="!filtered.length"
        class="px-2 py-10 text-center text-xs text-[var(--color-ink-3)]"
      >
        {{ conversations.length ? '无匹配会话' : '点击「+」开始新对话' }}
      </div>
    </template>

    <template #footer>
      <HintCard title="主对话 Agent">
        <template #icon>
          <AppIcon name="chat" :size="12" :stroke-width="2.2" />
        </template>
        新会话默认使用「主对话」Agent 及其绑定模型。请先在模型选型中配置 Key。
      </HintCard>
    </template>
  </ListPane>
</template>
