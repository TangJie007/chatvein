<script setup lang="ts">
import { computed, ref } from 'vue'
import ListPane from '../../components/layout/ListPane.vue'
import ListRow from '../../components/list/ListRow.vue'
import SectionLabel from '../../components/list/SectionLabel.vue'
import HintCard from '../../components/list/HintCard.vue'
import Avatar from '../../components/ui/Avatar.vue'
import Tag from '../../components/ui/Tag.vue'
import AppIcon from '../../components/AppIcon.vue'
import type { AgentConfig } from '../../ipc-api'

const props = defineProps<{
  agents: AgentConfig[]
  modelValue?: string
  loading?: boolean
  modelLabel?: (a: AgentConfig) => string
}>()
const emit = defineEmits<{ 'update:modelValue': [string]; select: [AgentConfig]; add: [] }>()

const query = ref('')
const q = computed(() => query.value.trim().toLowerCase())
const mainAgents = computed(() =>
  props.agents.filter((a) => a.isMain && match(a, q.value)),
)
const roleAgents = computed(() =>
  props.agents.filter((a) => !a.isMain && match(a, q.value)),
)

function labelOf(a: AgentConfig): string {
  return props.modelLabel?.(a) ?? (a.modelId || '未选模型')
}

function match(a: AgentConfig, term: string): boolean {
  if (!term) return true
  return [a.name, a.role, a.modelId, a.desc, labelOf(a)].some((s) => (s ?? '').toLowerCase().includes(term))
}
</script>

<template>
  <ListPane
    v-model="query"
    title="Agent 角色"
    :count="String(agents.length).padStart(2, '0')"
    search-placeholder="搜索角色…"
    @add="emit('add')"
  >
    <div v-if="loading" class="px-2 py-6 text-center text-xs text-[var(--color-ink-3)]">加载配置…</div>

    <template v-else>
      <SectionLabel v-if="mainAgents.length" title="主对话" />
      <ListRow
        v-for="a in mainAgents"
        :key="a.id"
        :active="modelValue === a.id"
        @click="emit('select', a)"
      >
        <template #leading>
          <Avatar :initial="a.initial" :tint="a.tint" :dot="a.enabled ? 'thinking' : 'idle'" />
        </template>
        <template #body>
          <div class="truncate text-[13px] font-semibold text-[var(--color-ink-1)]">{{ a.name }}</div>
          <div class="mt-0.5 truncate text-xs text-[var(--color-ink-2)]">{{ labelOf(a) }}</div>
        </template>
        <template #meta>
          <Tag tone="brand" sm>默认</Tag>
        </template>
      </ListRow>

      <SectionLabel v-if="roleAgents.length" title="已创建角色" />
      <ListRow
        v-for="a in roleAgents"
        :key="a.id"
        :active="modelValue === a.id"
        @click="emit('select', a)"
      >
        <template #leading>
          <Avatar :initial="a.initial" :tint="a.tint" :dot="a.enabled ? 'online' : 'idle'" />
        </template>
        <template #body>
          <div class="truncate text-[13px] font-semibold text-[var(--color-ink-1)]">{{ a.name }}</div>
          <div class="mt-0.5 truncate text-xs text-[var(--color-ink-2)]">{{ a.role }} · {{ labelOf(a) }}</div>
        </template>
        <template #meta>
          <Tag v-if="a.enabled" tone="brand" sm>{{ a.tools.length }} 工具</Tag>
          <Tag v-else tone="warn" sm>已停用</Tag>
        </template>
      </ListRow>
    </template>

    <template #footer>
      <HintCard title="角色配置">
        <template #icon>
          <AppIcon name="sun" :size="12" :stroke-width="2.2" />
        </template>
        可编辑身份、模型与系统提示词。能力绑定与护栏一期占位，后续再接入。
      </HintCard>
    </template>
  </ListPane>
</template>
