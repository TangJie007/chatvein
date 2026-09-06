<script setup lang="ts">
import { computed, ref } from 'vue'
import ListPane from '../../components/layout/ListPane.vue'
import ListRow from '../../components/list/ListRow.vue'
import SectionLabel from '../../components/list/SectionLabel.vue'
import HintCard from '../../components/list/HintCard.vue'
import AppIcon from '../../components/AppIcon.vue'
import type { VectorTableInfo } from '../../ipc-api'

const props = defineProps<{
  tables: VectorTableInfo[]
  selected?: string | null
  loading?: boolean
}>()

const emit = defineEmits<{ select: [name: string] }>()

const query = ref('')
const q = computed(() => query.value.trim().toLowerCase())
const filtered = computed(() =>
  props.tables.filter((t) => !q.value || t.name.toLowerCase().includes(q.value)),
)

function pick(name: string) {
  emit('select', name)
}
</script>

<template>
  <ListPane
    v-model="query"
    title="数据表"
    :count="String(tables.length).padStart(2, '0')"
    search-placeholder="搜索数据表…"
    hide-add
  >
    <div v-if="loading" class="px-2 py-6 text-center text-xs text-[var(--color-ink-3)]">
      读取表清单…
    </div>

    <template v-else>
      <SectionLabel v-if="filtered.length" title="向量表" />
      <ListRow
        v-for="t in filtered"
        :key="t.name"
        :active="t.name === selected"
        @click="pick(t.name)"
      >
        <template #leading>
          <span
            class="grid h-9 w-9 place-items-center rounded-[12px] text-[var(--color-brand-deep)]"
            style="background: linear-gradient(180deg, var(--color-brand-mist), rgb(233 236 249 / 0.55))"
          >
            <AppIcon name="vector" :size="16" />
          </span>
        </template>
        <template #body>
          <div class="truncate font-mono text-[12.5px] font-semibold text-[var(--color-ink-1)]">
            {{ t.name }}
          </div>
          <div class="mt-0.5 truncate text-xs text-[var(--color-ink-2)]">
            {{ t.columns.length }} 列 · LanceDB
          </div>
        </template>
        <template #meta>
          <span class="whitespace-nowrap rounded-full bg-[var(--color-canvas)] px-2 py-0.5 font-mono text-[10.5px] text-[var(--color-ink-3)]">
            {{ t.count }}
          </span>
        </template>
      </ListRow>

      <div
        v-if="!filtered.length"
        class="px-2 py-10 text-center text-xs text-[var(--color-ink-3)]"
      >
        {{ tables.length ? '无匹配数据表' : '索引尚未就绪' }}
      </div>
    </template>

    <template #footer>
      <HintCard title="向量数据集 · LanceDB">
        <template #icon>
          <AppIcon name="vector" :size="12" :stroke-width="2.2" />
        </template>
        内置工具索引在应用启动后后台自动预建（首次需下载本地嵌入模型），MCP / 动态工具随对话增量收录。
      </HintCard>
    </template>
  </ListPane>
</template>
