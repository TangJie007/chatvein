<script setup lang="ts">
import { computed, ref } from 'vue'
import ListPane from '../../components/layout/ListPane.vue'
import ListRow from '../../components/list/ListRow.vue'
import SectionLabel from '../../components/list/SectionLabel.vue'
import HintCard from '../../components/list/HintCard.vue'
import Avatar from '../../components/ui/Avatar.vue'
import AppIcon from '../../components/AppIcon.vue'
import { conversations } from '../../data/lists'
import type { ConversationRow } from '../../data/types'

const props = defineProps<{ modelValue?: string }>()
const emit = defineEmits<{
  'update:modelValue': [string]
  select: [ConversationRow]
}>()

const query = ref('')
const selected = ref(props.modelValue ?? 'terry')

const pinned = computed(() =>
  conversations.filter(
    (c) => c.section.includes('1:1') && c.name.toLowerCase().includes(query.value.toLowerCase()),
  ),
)
const plain = computed(() =>
  conversations.filter(
    (c) => !c.section.includes('1:1') && c.name.toLowerCase().includes(query.value.toLowerCase()),
  ),
)

function pick(c: ConversationRow) {
  selected.value = c.id
  emit('update:modelValue', c.id)
  emit('select', c)
}
</script>

<template>
  <ListPane title="对话" count="12" search-placeholder="搜索会话或消息…" v-model="query">
    <SectionLabel title="置顶 · 1:1" />
    <ListRow
      v-for="c in pinned"
      :key="c.id"
      :active="selected === c.id"
      @click="pick(c)"
    >
      <template #leading>
        <Avatar :initial="c.initial" :tint="c.tint" :dot="c.dot ?? 'none'" />
      </template>
      <template #body>
        <div class="flex items-center gap-1.5 whitespace-nowrap text-[13px] font-semibold text-[var(--color-ink-1)]">
          <span class="truncate">{{ c.name }}</span>
          <span v-if="c.pinned" class="shrink-0 text-[10.5px] text-[var(--color-brand-deep)]">★</span>
        </div>
        <div class="mt-0.5 max-w-[196px] truncate text-xs text-[var(--color-ink-2)]">{{ c.sub }}</div>
      </template>
      <template #meta>
        <span class="whitespace-nowrap font-mono text-[10.5px] font-medium text-[var(--color-ink-3)]">{{ c.time }}</span>
        <span
          v-if="c.badge !== undefined"
          class="rounded-full px-1.5 py-0.5 text-center font-mono text-[10px] font-semibold"
          :class="
            c.badgeTone === 'warn'
              ? 'bg-[var(--color-warn)] text-[var(--color-warn-ink)]'
              : c.badgeTone === 'muted'
                ? 'bg-[var(--color-hover)] text-[var(--color-ink-3)]'
                : 'bg-[var(--color-brand)] text-white'
          "
          >{{ c.badge === 'dot' ? '·' : c.badge }}</span
        >
      </template>
    </ListRow>

    <div class="h-2" />
    <SectionLabel title="纯对话 · 不挂工具" />
    <ListRow
      v-for="c in plain"
      :key="c.id"
      :active="selected === c.id"
      @click="pick(c)"
    >
      <template #leading>
        <Avatar :initial="c.initial" :tint="c.tint" :dot="c.dot ?? 'none'" />
      </template>
      <template #body>
        <div class="truncate text-[13px] font-semibold text-[var(--color-ink-1)]">{{ c.name }}</div>
        <div class="mt-0.5 max-w-[196px] truncate text-xs text-[var(--color-ink-2)]">{{ c.sub }}</div>
      </template>
      <template #meta>
        <span class="whitespace-nowrap font-mono text-[10.5px] font-medium text-[var(--color-ink-3)]">{{ c.time }}</span>
      </template>
    </ListRow>

    <template #footer>
      <HintCard title="长期记忆 3 条">
        <template #icon>
          <AppIcon name="pin" :size="12" :stroke-width="2.2" />
        </template>
        偏好表结构化输出 · 不要 border · 先确认方向再写码 · 主色取参考图靛蓝
        <strong class="font-semibold">#6178D0</strong>。
      </HintCard>
    </template>
  </ListPane>
</template>
