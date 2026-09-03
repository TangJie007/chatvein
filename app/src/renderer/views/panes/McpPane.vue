<script setup lang="ts">
import { computed, ref } from 'vue'
import ListPane from '../../components/layout/ListPane.vue'
import ListRow from '../../components/list/ListRow.vue'
import SectionLabel from '../../components/list/SectionLabel.vue'
import HintCard from '../../components/list/HintCard.vue'
import Avatar from '../../components/ui/Avatar.vue'
import Tag from '../../components/ui/Tag.vue'
import AppIcon from '../../components/AppIcon.vue'
import { mcps } from '../../data/lists'
import type { McpRow } from '../../data/types'

const props = defineProps<{ modelValue?: string }>()
const emit = defineEmits<{ 'update:modelValue': [string]; select: [McpRow] }>()

const query = ref('')
const selected = ref(props.modelValue ?? 'filesystem')
const list = computed(() =>
  mcps.filter((m) => m.name.toLowerCase().includes(query.value.toLowerCase())),
)
function pick(m: McpRow) {
  selected.value = m.id
  emit('update:modelValue', m.id)
  emit('select', m)
}
</script>

<template>
  <ListPane title="MCP 服务器" count="06" search-placeholder="搜索服务器…" v-model="query">
    <SectionLabel title="已连接" />
    <ListRow v-for="m in list" :key="m.id" :active="selected === m.id" @click="pick(m)">
      <template #leading><Avatar :initial="m.initial" :tint="m.tint" /></template>
      <template #body>
        <div class="truncate font-mono text-[13px] font-semibold text-[var(--color-ink-1)]">{{ m.name }}</div>
        <div class="mt-0.5 truncate text-xs text-[var(--color-ink-2)]">{{ m.transport }} · {{ m.tools }} 个工具</div>
      </template>
      <template #meta>
        <Tag :tone="m.status === 'on' ? 'ok' : m.status === 'err' ? 'danger' : 'default'" sm>{{ m.status === 'on' ? 'on' : m.status === 'err' ? 'err' : 'off' }}</Tag>
      </template>
    </ListRow>

    <template #footer>
      <HintCard title="工具按 Agent 授权">
        <template #icon><AppIcon name="shield" :size="12" :stroke-width="2.2" /></template>
        MCP 全局装好之后，具体给哪个 Agent 用，在角色配置里勾选。
      </HintCard>
    </template>
  </ListPane>
</template>
