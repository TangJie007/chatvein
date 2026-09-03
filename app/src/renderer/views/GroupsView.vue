<script setup lang="ts">
import { onMounted, ref } from 'vue'
import GroupsPane from './panes/GroupsPane.vue'
import ChatMessage from '../components/chat/ChatMessage.vue'
import AgentTrace from '../components/chat/AgentTrace.vue'
import Composer from '../components/chat/Composer.vue'
import Segmented from '../components/ui/Segmented.vue'
import ChipButton from '../components/ui/ChipButton.vue'
import Tag from '../components/ui/Tag.vue'
import AppIcon from '../components/AppIcon.vue'
import AvatarStack from '../components/list/AvatarStack.vue'
import Avatar from '../components/ui/Avatar.vue'
import { groupTrace } from '../data/chat'
import type { GroupRow } from '../data/types'
import { setCrumbItem } from '../composables/useUi'

const mode = ref<'主管制' | '轮询' | '自由讨论'>('主管制')
const stack = [
  { initial: 'T', tint: 'indigo' as const },
  { initial: 'D', tint: 'teal' as const },
  { initial: 'P', tint: 'sky' as const },
]

function onSelect(g: GroupRow) {
  mode.value = g.mode
  setCrumbItem(g.name)
}
onMounted(() => setCrumbItem('RAG 重构攻坚组'))

function onSend(t: string) {
  console.info('group send', t)
}
</script>

<template>
  <GroupsPane @select="onSelect" />

  <main
    class="relative grid min-h-0 min-w-0 overflow-hidden"
    style="
      grid-template-rows: auto 1fr auto;
      background:
        radial-gradient(80% 40% at 50% 0%, rgb(254 254 254 / 0.85), transparent 70%),
        var(--color-canvas);
    "
  >
    <header class="flex items-center justify-between gap-4 px-[26px] pb-3.5 pt-4">
      <div class="flex min-w-0 items-center gap-3">
        <AvatarStack :items="stack" :more="1" />
        <div>
          <div class="font-serif text-[22px] leading-[1.15] tracking-[0.2px] text-[var(--color-ink-1)]">RAG 重构攻坚组</div>
          <div class="mt-[3px] flex items-center gap-2 text-xs text-[var(--color-ink-3)]">
            <span>4 位成员 · 3 Agent</span>
            <Tag tone="info" sm>协作中</Tag>
          </div>
        </div>
      </div>
      <div class="flex shrink-0 items-center gap-3">
        <Segmented v-model="mode" :options="['主管制', '轮询', '自由讨论']" />
        <ChipButton><AppIcon name="gear" :size="13" /> 群设置</ChipButton>
      </div>
    </header>

    <div class="scroll-thin flex min-h-0 flex-col gap-[13px] overflow-y-auto px-[26px] pb-4 pt-2.5" aria-live="polite">
      <div class="self-center rounded-full bg-[var(--color-track)] px-3.5 py-[7px] text-center text-[11.5px] text-[var(--color-ink-3)]">
        群组创建于 周二 · 主管制 · Terry 为编排者
      </div>

      <ChatMessage role="user" initial="唐" tint="sky" time="14:02">
        <span class="inline-flex items-center gap-1 rounded-md bg-white/[0.24] px-[7px] py-px text-[12.5px] font-semibold text-[#EEF1FF]">@全体</span>
        这周目标就一个：把 RAG 的检索质量提上去。hit@5 现在 0.71，想拉到 0.85 以上。
      </ChatMessage>

      <ChatMessage role="agent" initial="T" tint="indigo" author="Terry" role-mini="orchestrator" time="14:02">
        拆成三件事并行，我盯结果汇总。
      </ChatMessage>

      <!-- assignment card -->
      <div class="ml-11 max-w-[82%] rounded-[var(--radius-card)] bg-[var(--color-elevated)] px-4 pb-4 pt-3.5 shadow-[var(--shadow-1)]">
        <h5 class="m-0 mb-2.5 flex items-center gap-[7px] text-[12.5px] font-semibold text-[var(--color-ink-1)]">
          <span class="grid h-[18px] w-[18px] place-items-center rounded-md bg-[var(--color-brand-soft)] font-mono text-[10px] font-semibold text-[var(--color-brand-deep)]">⇄</span>
          任务分工 · 由 Terry 派发
        </h5>
        <div v-for="(item, i) in [
          { av: 'D', tint: 'teal' as const, title: '重写分块 + 重跑评测', desc: '语义分块 512 / overlap 12% · 输出 RAGAS 前后对比', tag: '进行中', tone: 'ok' as const },
          { av: 'P', tint: 'sky' as const, title: 'rerank 灰度开关', desc: '加一个可回滚的开关，先 10% 流量', tag: '待开始', tone: 'warn' as const },
          { av: 'R', tint: 'violet' as const, title: '检索链路埋点', desc: '每次召回记 chunk id 与分数，便于回溯', tag: '未分配', tone: 'default' as const },
        ]" :key="i" class="mt-1.5 grid grid-cols-[26px_1fr_auto] items-center gap-2.5 rounded-xl bg-[var(--color-track)] px-2.5 py-[9px]">
          <Avatar :initial="item.av" :tint="item.tint" size="sm" />
          <div>
            <div class="text-[12.5px] font-medium text-[var(--color-ink-1)]">{{ item.title }}</div>
            <div class="mt-0.5 text-[11.5px] text-[var(--color-ink-3)]">{{ item.desc }}</div>
          </div>
          <Tag :tone="item.tone" sm>{{ item.tag }}</Tag>
        </div>
      </div>

      <ChatMessage role="agent" initial="D" tint="teal" author="DocWriter" role-mini="rag" time="14:06">
        分块改完跑了一轮：<strong>hit@5 从 0.71 → 0.83</strong>。rerank 打开还能再 +0.03，但单次成本涨 41%。
      </ChatMessage>

      <AgentTrace :steps="groupTrace" pill="✓ 完成 · 3 步" pill-tone="ok" meta="DocWriter · 6.2s · ¥0.014" />

      <div
        class="self-center flex items-center gap-2.5 rounded-full px-3.5 py-2 font-mono text-[11.5px] font-medium text-[var(--color-brand-deep)]"
        style="background: linear-gradient(90deg, rgb(233 236 249 / 0.9), rgb(240 242 251 / 0.6)); box-shadow: inset 0 0 0 1px rgb(97 120 208 / 0.18)"
      >
        <span>DocWriter</span><span class="text-[var(--color-ink-3)]">→</span><span>Porter</span>
        <span class="text-[var(--color-ink-3)]">交接：评测数据已落到 kb 报告</span>
      </div>

      <ChatMessage role="agent" initial="P" tint="sky" author="Porter" role-mini="deploy" time="14:09">
        收到。灰度开关已经排进周四的发布窗口，默认 <code class="rounded bg-[var(--color-input)] px-1.5 py-px font-mono text-[12.5px] text-[var(--color-brand-deep)]">rerank=false</code>，走配置中心下发，不用重新发版。
      </ChatMessage>

      <ChatMessage role="user" initial="唐" tint="sky">
        <span class="inline-flex items-center gap-1 rounded-md bg-white/[0.24] px-[7px] py-px text-[12.5px] font-semibold text-[#EEF1FF]">@Porter</span>
        先别发生产，等我把这一版的评估报告看完。
      </ChatMessage>

      <ChatMessage role="agent" initial="P" tint="sky" author="Porter" time="14:10">
        好，发布任务挂起，等你在群里说一声我再放行。
        <template #tick>blocked by you</template>
      </ChatMessage>
    </div>

    <Composer
      placeholder="在群里说点什么… 不 @ 则由 Terry 自动分发"
      :scope-label="mode"
      send-label="发送到群组"
      hint="指定成员 · 不 @ 则由主管分发"
      @send="onSend"
    >
      <template #tools>
        <button class="grid h-[30px] w-[30px] place-items-center rounded-[9px] border-0 bg-transparent text-[var(--color-ink-2)] transition-colors hover:bg-[var(--color-hover)] hover:text-[var(--color-ink-1)]" aria-label="@ 成员"><AppIcon name="at" :size="16" :stroke-width="2" /></button>
        <button class="grid h-[30px] w-[30px] place-items-center rounded-[9px] border-0 bg-transparent text-[var(--color-ink-2)] transition-colors hover:bg-[var(--color-hover)] hover:text-[var(--color-ink-1)]" aria-label="派发任务"><AppIcon name="check-square" :size="16" :stroke-width="2" /></button>
        <button class="grid h-[30px] w-[30px] place-items-center rounded-[9px] border-0 bg-transparent text-[var(--color-ink-2)] transition-colors hover:bg-[var(--color-hover)] hover:text-[var(--color-ink-1)]" aria-label="附件"><AppIcon name="paperclip" :size="16" :stroke-width="2" /></button>
      </template>
      <template #footer-left><span>· 3 Agent 在线</span></template>
      <template #statbar>
        <span class="inline-flex items-center gap-1.5 before:h-[5px] before:w-[5px] before:rounded-full before:bg-[var(--color-brand)] before:content-['']">本轮 3 Agent · 12 步</span>
        <span class="inline-flex items-center gap-1.5 before:h-[5px] before:w-[5px] before:rounded-full before:bg-[#9FCADB] before:content-['']">tokens 18.4k · ¥0.042</span>
        <span class="inline-flex items-center gap-1.5 before:h-[5px] before:w-[5px] before:rounded-full before:bg-[var(--color-ok)] before:content-['']">交接 1 次 · 阻塞 1 项</span>
      </template>
    </Composer>
  </main>
</template>
