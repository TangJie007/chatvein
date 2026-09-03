<script setup lang="ts">
import { computed, ref } from 'vue'
import ListPane from '../../components/layout/ListPane.vue'
import ListRow from '../../components/list/ListRow.vue'
import SectionLabel from '../../components/list/SectionLabel.vue'
import HintCard from '../../components/list/HintCard.vue'
import AvatarStack from '../../components/list/AvatarStack.vue'
import AppIcon from '../../components/AppIcon.vue'
import { groups } from '../../data/lists'
import type { GroupRow } from '../../data/types'

const props = defineProps<{ modelValue?: string }>()
const emit = defineEmits<{ 'update:modelValue': [string]; select: [GroupRow] }>()

const query = ref('')
const selected = ref(props.modelValue ?? 'rag')
const list = computed(() =>
  groups.filter((g) => g.name.toLowerCase().includes(query.value.toLowerCase())),
)

function pick(g: GroupRow) {
  selected.value = g.id
  emit('update:modelValue', g.id)
  emit('select', g)
}
</script>

<template>
  <ListPane title="工作群组" count="03" search-placeholder="搜索群组…" v-model="query">
    <SectionLabel title="进行中" />
    <ListRow v-for="g in list" :key="g.id" :active="selected === g.id" @click="pick(g)">
      <template #leading>
        <AvatarStack :items="g.stack" />
      </template>
      <template #body>
        <div class="truncate text-[13px] font-semibold text-[var(--color-ink-1)]">{{ g.name }}</div>
        <div class="mt-0.5 truncate text-xs text-[var(--color-ink-2)]">{{ g.sub }}</div>
      </template>
      <template #meta>
        <span class="whitespace-nowrap font-mono text-[10.5px] font-medium text-[var(--color-ink-3)]">{{ g.time }}</span>
        <span
          v-if="g.badge !== undefined"
          class="rounded-full px-1.5 py-0.5 text-center font-mono text-[10px] font-semibold"
          :class="
            g.badgeTone === 'warn'
              ? 'bg-[var(--color-warn)] text-[var(--color-warn-ink)]'
              : g.badgeTone === 'muted'
                ? 'bg-[var(--color-hover)] text-[var(--color-ink-3)]'
                : 'bg-[var(--color-brand)] text-white'
          "
          >{{ g.badge === 'dot' ? '·' : g.badge }}</span
        >
      </template>
    </ListRow>

    <template #footer>
      <HintCard title="三种协作模式">
        <template #icon>
          <AppIcon name="users" :size="12" :stroke-width="2.2" />
        </template>
        <strong class="font-semibold">主管制</strong> 一个 Agent 拆解派活 ·
        <strong class="font-semibold">轮询</strong> 依次发言 ·
        <strong class="font-semibold">自由讨论</strong> 谁 relevant 谁接。
      </HintCard>
    </template>
  </ListPane>
</template>
