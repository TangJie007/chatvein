<script setup lang="ts">
import { computed, ref } from 'vue'
import ListPane from '../../components/layout/ListPane.vue'
import ListRow from '../../components/list/ListRow.vue'
import SectionLabel from '../../components/list/SectionLabel.vue'
import HintCard from '../../components/list/HintCard.vue'
import Avatar from '../../components/ui/Avatar.vue'
import Tag from '../../components/ui/Tag.vue'
import AppIcon from '../../components/AppIcon.vue'
import { skills } from '../../data/lists'
import type { SkillRow } from '../../data/types'

const props = defineProps<{ modelValue?: string }>()
const emit = defineEmits<{ 'update:modelValue': [string]; select: [SkillRow] }>()

const query = ref('')
const selected = ref(props.modelValue ?? 'prd-to-spec')
const list = computed(() =>
  skills.filter((s) => s.name.toLowerCase().includes(query.value.toLowerCase())),
)
function pick(s: SkillRow) {
  selected.value = s.id
  emit('update:modelValue', s.id)
  emit('select', s)
}
</script>

<template>
  <ListPane title="Skills" count="08" search-placeholder="搜索 Skill…" v-model="query">
    <SectionLabel title="本项目" />
    <ListRow v-for="s in list" :key="s.id" :active="selected === s.id" @click="pick(s)">
      <template #leading><Avatar :initial="s.initial" :tint="s.tint" /></template>
      <template #body>
        <div class="truncate font-mono text-[13px] font-semibold text-[var(--color-ink-1)]">{{ s.name }}</div>
        <div class="mt-0.5 truncate text-xs text-[var(--color-ink-2)]">{{ s.cat }} · {{ s.triggers.length }} 触发词</div>
      </template>
      <template #meta>
        <Tag :tone="s.enabled ? 'ok' : 'default'" sm>{{ s.enabled ? 'on' : 'off' }}</Tag>
      </template>
    </ListRow>

    <template #footer>
      <HintCard title="触发词即入口">
        <template #icon><AppIcon name="bulb" :size="12" :stroke-width="2.2" /></template>
        Skill 靠触发词被路由命中，写准口语说法比写术语管用。
      </HintCard>
    </template>
  </ListPane>
</template>
