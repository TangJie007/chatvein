<script setup lang="ts">
import { onMounted, ref } from 'vue'
import SkillsPane from './panes/SkillsPane.vue'
import ViewShell from '../components/layout/ViewShell.vue'
import Card from '../components/ui/Card.vue'
import KvRow from '../components/ui/KvRow.vue'
import AppButton from '../components/ui/AppButton.vue'
import SwitchToggle from '../components/ui/SwitchToggle.vue'
import Tag from '../components/ui/Tag.vue'
import Avatar from '../components/ui/Avatar.vue'
import { skills } from '../data/lists'
import type { SkillRow } from '../data/types'
import { setCrumbItem } from '../composables/useUi'

const current = ref<SkillRow>(skills[0])
const enabled = ref(true)
const agentAuth = ref<Record<string, boolean>>({
  Terry: true,
  DocWriter: true,
  Porter: false,
  'Ksher Audit': false,
})

function onSelect(s: SkillRow) {
  current.value = s
  enabled.value = s.enabled
  setCrumbItem(s.name)
}
onMounted(() => setCrumbItem(current.value.name))

const files = [
  { name: 'SKILL.md', sub: '入口定义', size: '2.1 KB' },
  { name: 'scripts/parse_prd.py', sub: '', size: '6.4 KB' },
  { name: 'scripts/render_spec.py', sub: '', size: '4.8 KB' },
  { name: 'references/template.md', sub: '', size: '1.2 KB' },
]
</script>

<template>
  <SkillsPane @select="onSelect" />

  <ViewShell foot-note="最近调用 · 今天 11:26 · 耗时 24.6s">
    <template #identity>
      <Avatar :initial="current.initial" :tint="current.tint" size="lg" />
      <div>
        <div class="font-mono text-[22px] leading-[1.15] tracking-[0.2px] text-[var(--color-ink-1)]">{{ current.name }}</div>
        <div class="mt-[3px] flex flex-wrap items-center gap-2 text-xs text-[var(--color-ink-3)]">
          <Tag tone="brand" sm>{{ current.version }}</Tag>
          <span>{{ current.cat }}</span>
          <span>{{ current.owner }}</span>
          <Tag tone="ok" sm>{{ enabled ? '已启用' : '已停用' }}</Tag>
        </div>
      </div>
    </template>
    <template #actions>
      <AppButton size="sm">在编辑器打开</AppButton>
      <AppButton size="sm">试运行</AppButton>
      <SwitchToggle v-model="enabled" label="启用 Skill" />
    </template>

    <Card title="触发词" side="命中即路由到本 Skill">
      <div class="flex flex-wrap gap-1.5">
        <Tag v-for="t in current.triggers" :key="t" tone="brand">{{ t }}</Tag>
      </div>
      <p class="mt-2.5 mb-0 text-[11.5px] text-[var(--color-ink-3)]">
        口语说法比术语更容易命中，建议每个 Skill 至少写 3 条。
      </p>
    </Card>

    <Card title="描述" side="description">
      <p class="m-0 text-[13.5px] leading-[1.65] text-[var(--color-ink-2)]">{{ current.desc }}</p>
    </Card>

    <Card title="SKILL.md" side="frontmatter">
      <pre class="m-0 overflow-x-auto rounded-xl bg-[var(--color-track)] px-3.5 py-3 font-mono text-[11.5px] leading-[1.75] text-[var(--color-ink-2)]"><span class="text-[var(--color-ink-3)]">---</span>
<span class="text-[var(--color-brand-deep)]">name</span>: {{ current.name }}
<span class="text-[var(--color-brand-deep)]">description</span>: <span class="text-[var(--color-ok-ink)]">{{ current.desc }}</span>
<span class="text-[var(--color-brand-deep)]">agent_created</span>: <span class="text-[var(--color-ok-ink)]">true</span>
<span class="text-[var(--color-ink-3)]">---</span>

<span class="italic text-[var(--color-ink-3)]"># 工作流</span>
1. 通读 PRD，抽出一二级模块
2. 按模块建目录，每个模块输出 spec.yaml + spec.md
3. 字段缺失时先反问，不要自行补全业务规则
4. 最后输出一份模块清单便于复查</pre>
    </Card>

    <div class="grid grid-cols-2 gap-3.5">
      <Card title="文件" :side="current.files">
        <KvRow v-for="f in files" :key="f.name" :k="f.name" :sub="f.sub" mono>{{ f.size }}</KvRow>
      </Card>
      <Card title="授权给 Agent" side="routing">
        <KvRow v-for="(v, name) in agentAuth" :key="name" :k="name">
          <SwitchToggle :model-value="v" :label="name" @update:model-value="(val) => (agentAuth[name] = val)" />
        </KvRow>
      </Card>
    </div>

    <template #footer>
      <div class="flex gap-2">
        <AppButton>导出</AppButton>
        <AppButton variant="primary">保存</AppButton>
      </div>
    </template>
  </ViewShell>
</template>
