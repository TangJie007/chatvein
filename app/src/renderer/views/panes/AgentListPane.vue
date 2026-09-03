<script setup lang="ts">
import { computed, ref } from 'vue'
import ListPane from '../../components/layout/ListPane.vue'
import ListRow from '../../components/list/ListRow.vue'
import SectionLabel from '../../components/list/SectionLabel.vue'
import HintCard from '../../components/list/HintCard.vue'
import Avatar from '../../components/ui/Avatar.vue'
import Tag from '../../components/ui/Tag.vue'
import AppIcon from '../../components/AppIcon.vue'
import { agents } from '../../data/lists'
import type { AgentRow } from '../../data/types'

const props = defineProps<{ modelValue?: string }>()
const emit = defineEmits<{ 'update:modelValue': [string]; select: [AgentRow] }>()

const query = ref('')
const selected = ref(props.modelValue ?? 'terry')

const list = computed(() =>
  agents.filter((a) => a.name.toLowerCase().includes(query.value.toLowerCase())),
)

function pick(a: AgentRow) {
  selected.value = a.id
  emit('update:modelValue', a.id)
  emit('select', a)
}
</script>

<template>
  <ListPane title="Agent 角色" count="05" search-placeholder="搜索角色…" v-model="query">
    <SectionLabel title="已创建" />
    <ListRow v-for="a in list" :key="a.id" :active="selected === a.id" @click="pick(a)">
      <template #leading>
        <Avatar :initial="a.initial" :tint="a.tint" :dot="a.enabled ? (a.id === 'terry' ? 'thinking' : 'online') : 'idle'" />
      </template>
      <template #body>
        <div class="truncate text-[13px] font-semibold text-[var(--color-ink-1)]">{{ a.name }}</div>
        <div class="mt-0.5 truncate text-xs text-[var(--color-ink-2)]">{{ a.providerLabel }} · {{ a.model }}</div>
      </template>
      <template #meta>
        <Tag v-if="a.enabled" tone="brand" sm>{{ a.toolCount }} 工具</Tag>
        <Tag v-else tone="warn" sm>已停用</Tag>
      </template>
    </ListRow>

    <template #footer>
      <HintCard title="每个 Agent 独立 API">
        <template #icon>
          <AppIcon name="sun" :size="12" :stroke-width="2.2" />
        </template>
        角色之间 Provider / Base URL / Key / 模型互不影响，可以混用多家与本地 Relay。
      </HintCard>
    </template>
  </ListPane>
</template>
