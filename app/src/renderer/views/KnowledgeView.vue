<script setup lang="ts">
import { onMounted, ref } from 'vue'
import KnowledgePane from './panes/KnowledgePane.vue'
import ViewShell from '../components/layout/ViewShell.vue'
import Card from '../components/ui/Card.vue'
import KvRow from '../components/ui/KvRow.vue'
import TextInput from '../components/ui/TextInput.vue'
import AppButton from '../components/ui/AppButton.vue'
import SwitchToggle from '../components/ui/SwitchToggle.vue'
import Tag from '../components/ui/Tag.vue'
import Avatar from '../components/ui/Avatar.vue'
import { kbSearchResults } from '../data/chat'
import { knowledgeBases } from '../data/lists'
import type { KbRow } from '../data/types'
import { setCrumbItem } from '../composables/useUi'

const rerank = ref(false)
const query = ref('高血压患者日常饮食要注意什么')

function onSelect(k: KbRow) {
  setCrumbItem(k.name)
}
onMounted(() => setCrumbItem('医疗健康科普'))

const docs = [
  { name: '高血压-饮食.md', chunks: '148', size: '18.2 KB', date: '08-29', status: 'indexed' },
  { name: '血压自测.md', chunks: '96', size: '11.4 KB', date: '08-29', status: 'indexed' },
  { name: '降压药依从性.md', chunks: '132', size: '16.8 KB', date: '08-30', status: 'indexed' },
  { name: '糖尿病-血糖监测.md', chunks: '174', size: '22.1 KB', date: '08-30', status: 'indexed' },
  { name: '慢病运动处方.md', chunks: '118', size: '14.9 KB', date: '09-01', status: 'indexed' },
  { name: '体检报告怎么看.md', chunks: '—', size: '9.3 KB', date: '09-02', status: 'queued' },
]
const kb = knowledgeBases[0]
</script>

<template>
  <KnowledgePane @select="onSelect" />

  <ViewShell foot-note="索引占用 42.6 MB · 上次重建 09-01 23:14">
    <template #identity>
      <Avatar initial="医" tint="teal" size="lg" />
      <div>
        <div class="font-serif text-[22px] leading-[1.15] tracking-[0.2px] text-[var(--color-ink-1)]">{{ kb.name }}</div>
        <div class="mt-[3px] flex flex-wrap items-center gap-2 text-xs text-[var(--color-ink-3)]">
          <Tag tone="ok" sm>已就绪</Tag>
          <span>{{ kb.docs }}</span>
          <span>{{ kb.chunks }}</span>
          <Tag sm>{{ kb.store }}</Tag>
        </div>
      </div>
    </template>
    <template #actions>
      <AppButton size="sm">导入文档</AppButton>
      <AppButton size="sm" variant="primary">重建索引</AppButton>
    </template>

    <div class="grid grid-cols-2 gap-3.5">
      <Card title="检索参数" side="retrieval">
        <KvRow k="分块大小" mono>{{ kb.chunk }} tokens</KvRow>
        <KvRow k="重叠比例" mono>{{ kb.overlap }}</KvRow>
        <KvRow k="召回数量 top-k" mono>{{ kb.topK }}</KvRow>
        <KvRow k="相似度阈值" sub="低于该值直接丢弃" mono>{{ kb.thresh }}</KvRow>
        <KvRow k="Rerank" sub="二次精排，成本 +41%">
          <SwitchToggle v-model="rerank" label="rerank" />
        </KvRow>
      </Card>

      <Card title="嵌入与存储" side="embedding">
        <KvRow k="嵌入模型" mono>{{ kb.embed }}</KvRow>
        <KvRow k="向量库" mono>{{ kb.store }}</KvRow>
        <KvRow k="索引参数" sub="lists / probes" mono>100 / 10</KvRow>
        <KvRow k="平均召回延迟" mono>38 ms</KvRow>
        <KvRow k="最近重建" mono>09-01 23:14</KvRow>
      </Card>
    </div>

    <Card title="检索测试" side="命中 3 段 · 128 ms">
      <div class="flex gap-1.5">
        <TextInput v-model="query" class="flex-1" />
        <AppButton variant="primary">检索</AppButton>
      </div>
      <div class="mt-3.5 flex flex-col gap-2">
        <article
          v-for="s in kbSearchResults"
          :key="s.idx"
          class="rounded-[14px] px-3.5 py-3"
          :class="
            s.idx === 1
              ? 'bg-[var(--color-brand-soft)] shadow-[inset_0_0_0_1px_rgb(97_120_208/0.3)]'
              : 'bg-[var(--color-track)] shadow-[inset_0_0_0_1px_rgba(223,227,232,0.7)]'
          "
        >
          <div class="mb-[7px] flex items-center gap-2">
            <span class="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-md bg-[var(--color-brand)] font-mono text-[10px] font-semibold text-white">{{ s.idx }}</span>
            <span class="truncate font-mono text-xs font-medium text-[var(--color-ink-1)]">{{ s.file }}</span>
            <span class="ml-auto shrink-0 rounded-full bg-[#7fbfa8]/[0.22] px-[7px] py-0.5 font-mono text-[10.5px] font-semibold text-[var(--color-ok-ink)]">{{ s.score }}</span>
          </div>
          <p class="m-0 text-[12.5px] leading-[1.6] text-[var(--color-ink-2)]">{{ s.text }}</p>
        </article>
      </div>
    </Card>

    <Card title="文档" side="10 篇 · 全部已索引">
      <div class="overflow-hidden rounded-[13px] bg-[var(--color-track)]">
        <table class="w-full border-collapse">
          <thead>
            <tr class="text-left text-[11px] font-semibold uppercase tracking-[0.3px] text-[var(--color-brand-dark)]">
              <th class="px-2.5 py-2">文件</th><th class="px-2.5 py-2">chunks</th>
              <th class="px-2.5 py-2">大小</th><th class="px-2.5 py-2">更新时间</th><th class="px-2.5 py-2">状态</th>
            </tr>
          </thead>
          <tbody class="text-[12.5px] text-[var(--color-ink-2)]">
            <tr v-for="d in docs" :key="d.name" class="shadow-[inset_0_1px_0_rgba(223,227,232,0.8)] hover:bg-[rgba(240,241,244,0.7)]">
              <td class="px-2.5 py-[9px]"><strong class="font-semibold text-[var(--color-ink-1)]">{{ d.name }}</strong></td>
              <td class="px-2.5 py-[9px] font-mono text-[11.5px]">{{ d.chunks }}</td>
              <td class="px-2.5 py-[9px] font-mono text-[11.5px]">{{ d.size }}</td>
              <td class="px-2.5 py-[9px] font-mono text-[11.5px]">{{ d.date }}</td>
              <td class="px-2.5 py-[9px]"><Tag :tone="d.status === 'indexed' ? 'ok' : 'warn'" sm>{{ d.status }}</Tag></td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>

    <template #footer>
      <div class="flex gap-2">
        <AppButton>导出配置</AppButton>
        <AppButton variant="primary">保存</AppButton>
      </div>
    </template>
  </ViewShell>
</template>
