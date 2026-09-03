<script setup lang="ts">
import { computed, ref } from 'vue'
import ListPane from '../../components/layout/ListPane.vue'
import ListRow from '../../components/list/ListRow.vue'
import SectionLabel from '../../components/list/SectionLabel.vue'
import HintCard from '../../components/list/HintCard.vue'
import Avatar from '../../components/ui/Avatar.vue'
import Tag from '../../components/ui/Tag.vue'
import AppIcon from '../../components/AppIcon.vue'
import { knowledgeBases } from '../../data/lists'
import type { KbRow } from '../../data/types'

const props = defineProps<{ modelValue?: string }>()
const emit = defineEmits<{ 'update:modelValue': [string]; select: [KbRow] }>()

const query = ref('')
const selected = ref(props.modelValue ?? 'medical')
const list = computed(() =>
  knowledgeBases.filter((k) => k.name.toLowerCase().includes(query.value.toLowerCase())),
)
function pick(k: KbRow) {
  selected.value = k.id
  emit('update:modelValue', k.id)
  emit('select', k)
}
</script>

<template>
  <ListPane title="知识库" count="04" search-placeholder="搜索知识库…" v-model="query">
    <SectionLabel title="已索引" />
    <ListRow v-for="k in list" :key="k.id" :active="selected === k.id" @click="pick(k)">
      <template #leading><Avatar :initial="k.initial" :tint="k.tint" /></template>
      <template #body>
        <div class="truncate text-[13px] font-semibold text-[var(--color-ink-1)]">{{ k.name }}</div>
        <div class="mt-0.5 truncate text-xs text-[var(--color-ink-2)]">{{ k.sub }}</div>
      </template>
      <template #meta>
        <Tag :tone="k.status === 'ready' ? 'ok' : k.status === 'indexing' ? 'warn' : 'default'" sm>{{ k.statusLabel }}</Tag>
      </template>
    </ListRow>

    <template #footer>
      <HintCard title="检索参数按库独立">
        <template #icon><AppIcon name="pin" :size="12" :stroke-width="2.2" /></template>
        分块 / 嵌入 / 向量索引 / top-k 每个库单独配，不共用一套。
      </HintCard>
    </template>
  </ListPane>
</template>
