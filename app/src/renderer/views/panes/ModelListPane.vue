<script setup lang="ts">
import { computed, ref } from 'vue'
import ListPane from '../../components/layout/ListPane.vue'
import ListRow from '../../components/list/ListRow.vue'
import SectionLabel from '../../components/list/SectionLabel.vue'
import HintCard from '../../components/list/HintCard.vue'
import Tag from '../../components/ui/Tag.vue'
import AppIcon from '../../components/AppIcon.vue'
import type { ModelConfig } from '../../ipc-api'

const props = defineProps<{
  models: ModelConfig[]
  modelValue?: string
  loading?: boolean
  presetLabel: (provider: string) => string
}>()
const emit = defineEmits<{ 'update:modelValue': [string]; select: [ModelConfig]; add: [] }>()

const query = ref('')
const q = computed(() => query.value.trim().toLowerCase())

const enabledModels = computed(() =>
  props.models.filter((m) => m.enabled && match(m, q.value)),
)
const disabledModels = computed(() =>
  props.models.filter((m) => !m.enabled && match(m, q.value)),
)

function match(m: ModelConfig, term: string): boolean {
  if (!term) return true
  return [m.name, m.model, m.provider, m.baseUrl].some((s) => (s ?? '').toLowerCase().includes(term))
}
</script>

<template>
  <ListPane
    v-model="query"
    title="模型选型"
    :count="String(models.length).padStart(2, '0')"
    search-placeholder="搜索模型…"
    @add="emit('add')"
  >
    <div v-if="loading" class="px-2 py-6 text-center text-xs text-[var(--color-ink-3)]">加载配置…</div>

    <template v-else>
      <SectionLabel v-if="enabledModels.length" title="已启用" />
      <ListRow
        v-for="m in enabledModels"
        :key="m.id"
        :active="modelValue === m.id"
        @click="emit('select', m)"
      >
        <template #leading>
          <div
            class="grid h-9 w-9 place-items-center rounded-[12px] text-[var(--color-brand-deep)]"
            style="background: linear-gradient(180deg, var(--color-brand-mist), rgb(233 236 249 / 0.55))"
          >
            <AppIcon name="cpu" :size="16" />
          </div>
        </template>
        <template #body>
          <div class="truncate text-[13px] font-semibold text-[var(--color-ink-1)]">{{ m.name }}</div>
          <div class="mt-0.5 truncate text-xs text-[var(--color-ink-2)] font-mono">{{ m.model || '未填模型 id' }}</div>
        </template>
        <template #meta>
          <Tag tone="brand" sm>{{ presetLabel(m.provider) }}</Tag>
        </template>
      </ListRow>

      <SectionLabel v-if="disabledModels.length" title="已停用" />
      <ListRow
        v-for="m in disabledModels"
        :key="m.id"
        :active="modelValue === m.id"
        @click="emit('select', m)"
      >
        <template #leading>
          <div class="grid h-9 w-9 place-items-center rounded-[12px] bg-[rgba(223,227,232,0.55)] text-[var(--color-ink-3)]">
            <AppIcon name="cpu" :size="16" />
          </div>
        </template>
        <template #body>
          <div class="truncate text-[13px] font-semibold text-[var(--color-ink-1)]">{{ m.name }}</div>
          <div class="mt-0.5 truncate text-xs text-[var(--color-ink-2)] font-mono">{{ m.model }}</div>
        </template>
        <template #meta>
          <Tag tone="warn" sm>已停用</Tag>
        </template>
      </ListRow>
    </template>

    <template #footer>
      <HintCard title="一期 · OpenAI 兼容">
        <template #icon>
          <AppIcon name="sun" :size="12" :stroke-width="2.2" />
        </template>
        点击「+」添加真实模型。API Key 经系统加密落盘；已被 Agent 绑定的模型不可删除。
      </HintCard>
    </template>
  </ListPane>
</template>
