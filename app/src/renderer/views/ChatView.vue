<script setup lang="ts">
import { onMounted, ref } from 'vue'
import ConversationPane from './panes/ConversationPane.vue'
import ChatMessage from '../components/chat/ChatMessage.vue'
import AgentTrace from '../components/chat/AgentTrace.vue'
import GuardrailAlert from '../components/chat/GuardrailAlert.vue'
import Composer from '../components/chat/Composer.vue'
import ThinkingPanel from '../components/chat/ThinkingPanel.vue'
import SourceDrawer from '../components/layout/SourceDrawer.vue'
import ChipButton from '../components/ui/ChipButton.vue'
import AppIcon from '../components/AppIcon.vue'
import Avatar from '../components/ui/Avatar.vue'
import { doneTrace, runningTrace, sources } from '../data/chat'
import type { ConversationRow } from '../data/types'
import { setCrumbItem } from '../composables/useUi'

const active = ref<ConversationRow | null>(null)
const drawerOpen = ref(false)
const drawerHot = ref<number | null>(null)

function openSource(idx: number) {
  drawerHot.value = idx
  drawerOpen.value = true
}
function onSelect(c: ConversationRow) {
  active.value = c
  setCrumbItem(`${c.name} · ${c.cRole}`)
}

onMounted(() => setCrumbItem('Terry · 日常任务助理'))

function onSend(text: string) {
  // demo only — real send will go through harness later
  console.info('send:', text)
}
</script>

<template>
  <ConversationPane @select="onSelect" />

  <main
    class="relative min-h-0 min-w-0 overflow-hidden"
    style="
      background:
        radial-gradient(80% 40% at 50% 0%, rgb(254 254 254 / 0.85), transparent 70%),
        var(--color-canvas);
    "
  >
    <div class="grid h-full min-h-0" style="grid-template-columns: minmax(0, 1fr) 240px">
    <section class="grid h-full min-h-0" style="grid-template-rows: auto 1fr auto">
      <!-- header -->
      <header class="flex items-center justify-between gap-4 px-[26px] pb-3 pt-4">
        <div class="flex items-center gap-3">
          <Avatar initial="T" tint="indigo" size="lg" dot="thinking" />
          <div>
            <div class="font-serif text-[22px] leading-[1.15] tracking-[0.2px] text-[var(--color-ink-1)]">
              Terry · <em class="italic" style="color: var(--color-brand-deep)">日常任务助理</em>
            </div>
            <div class="mt-[3px] flex items-center gap-2">
              <span class="rounded-full bg-[var(--color-brand-soft)] px-2.5 py-[3px] font-mono text-[11px] font-medium uppercase tracking-[0.4px] text-[var(--color-brand-dark)]">react · rag</span>
              <span class="font-mono text-[11px] text-[var(--color-ink-3)]">deepseek-chat</span>
            </div>
          </div>
        </div>
        <div class="flex items-center gap-3.5">
          <div class="flex items-center gap-1.5 text-xs font-medium text-[var(--color-ink-2)]">
            <span class="h-[7px] w-[7px] rounded-full bg-[var(--color-brand)] dot-thinking" />
            正在思考 · 第 3 步
          </div>
          <div class="flex items-center gap-1">
            <ChipButton @click="drawerOpen = true; drawerHot = null">
              <AppIcon name="chart" :size="13" /> Trace
            </ChipButton>
            <ChipButton><AppIcon name="history" :size="13" /> 记忆</ChipButton>
            <ChipButton><AppIcon name="gear" :size="13" /> 设置</ChipButton>
          </div>
        </div>
      </header>

      <!-- messages -->
      <div class="scroll-thin flex min-h-0 flex-col gap-[13px] overflow-y-auto px-[26px] pb-4 pt-2.5" aria-live="polite">
        <div class="my-1.5 flex items-center gap-3.5 font-mono text-[11px] font-medium tracking-[0.4px] text-[var(--color-ink-3)]">
          <span class="h-px flex-1 bg-[linear-gradient(90deg,transparent,rgba(165,177,193,0.55),transparent)]" />
          今天 · 星期四
          <span class="h-px flex-1 bg-[linear-gradient(90deg,transparent,rgba(165,177,193,0.55),transparent)]" />
        </div>

        <ChatMessage role="user" initial="唐" tint="sky" time="14:32">
          帮我把昨天关于 <code class="rounded bg-white/20 px-1.5 py-px font-mono text-[12.5px] text-[#F2F4FF]">RAG</code> 的笔记按模块整理一下，写进 Obsidian 知识库 <code class="rounded bg-white/20 px-1.5 py-px font-mono text-[12.5px] text-[#F2F4FF]">AI 研究</code> 文件夹。要包含分块策略、向量选型、还有检索评估那三块。
        </ChatMessage>

        <ChatMessage role="agent" initial="T" tint="indigo" author="Terry" role-mini="orchestrator" time="14:32">
          好，先去翻 <code class="rounded bg-[var(--color-input)] px-1.5 py-px font-mono text-[12.5px] text-[var(--color-brand-deep)]">~/notes</code> 找昨天的内容定位到 RAG 那几篇，然后按你提到三个模块切分、最后写入 Obsidian。<strong>我边做边把步骤回给你看。</strong>
        </ChatMessage>

        <AgentTrace :steps="runningTrace" pill="● 正在执行 · 第 3 / 5 步" meta="累计 2.4s · tokens 1.2k · ¥0.003" :default-open="true" />

        <GuardrailAlert title="写入前拦截" detail="检测到目标文件夹已存在同名文件 rag-overview.md · 已暂停写入，等待你确认覆盖 / 重命名 / 跳过">
          <ChipButton>跳过</ChipButton>
          <ChipButton accent>确认覆盖</ChipButton>
        </GuardrailAlert>

        <ChatMessage role="agent" initial="T" tint="indigo" author="Terry" time="14:33">
          先停一下 ✋ — 我查到 Obsidian 那个目录里已经有 <code class="rounded bg-[var(--color-input)] px-1.5 py-px font-mono text-[12.5px] text-[var(--color-brand-deep)]">rag-overview.md</code>，你希望我怎么处理？
          <template #tick>trace ↳ step 3 → paused</template>
        </ChatMessage>

        <ChatMessage role="user" initial="唐" tint="sky">
          用 <code class="rounded bg-white/20 px-1.5 py-px font-mono text-[12.5px] text-[#F2F4FF]">rag-overview-v2.md</code> 重写一份，旧版先备份到 <code class="rounded bg-white/20 px-1.5 py-px font-mono text-[12.5px] text-[#F2F4FF]">Archive/2026-09</code>。
        </ChatMessage>

        <ChatMessage role="agent" initial="T" tint="indigo" author="Terry" time="14:34">
          好，备份 → 写入 → 校验索引三个动作我会一起做。
          <template #tick>trace ↳ resumed · 3 steps remaining</template>
        </ChatMessage>

        <AgentTrace :steps="doneTrace" pill="✓ 完成 · 3 步" pill-tone="ok" meta="总耗时 4.7s · tokens 3.8k · ¥0.009" />

        <ChatMessage role="agent" initial="T" tint="indigo" author="Terry" time="14:35">
          整理完成 ✅ 一共分成这三大块：
          <div class="mt-2.5 overflow-hidden rounded-[13px] bg-[var(--color-track)]">
            <table class="w-full border-collapse">
              <thead>
                <tr class="text-left text-[11px] font-semibold uppercase tracking-[0.3px] text-[var(--color-brand-dark)]">
                  <th class="px-2.5 py-2">模块</th><th class="px-2.5 py-2">要点</th><th class="px-2.5 py-2">文件</th>
                </tr>
              </thead>
              <tbody class="text-[12.5px] text-[var(--color-ink-2)]">
                <tr class="shadow-[inset_0_1px_0_rgba(223,227,232,0.8)]">
                  <td class="px-2.5 py-[9px]"><strong class="font-semibold text-[var(--color-ink-1)]">chunking</strong><button class="ml-1 inline-grid h-4 min-w-4 place-items-center rounded-[5px] border-0 bg-[var(--color-brand-soft)] px-1 font-mono text-[10px] font-semibold text-[var(--color-brand-deep)]" @click="openSource(1)">1</button></td>
                  <td class="px-2.5 py-[9px]">512 tokens · overlap 12% · 语义优先</td>
                  <td class="px-2.5 py-[9px] font-mono text-[11.5px]">rag-overview-v2.md#1</td>
                </tr>
                <tr class="shadow-[inset_0_1px_0_rgba(223,227,232,0.8)]">
                  <td class="px-2.5 py-[9px]"><strong class="font-semibold text-[var(--color-ink-1)]">embedding</strong><button class="ml-1 inline-grid h-4 min-w-4 place-items-center rounded-[5px] border-0 bg-[var(--color-brand-soft)] px-1 font-mono text-[10px] font-semibold text-[var(--color-brand-deep)]" @click="openSource(2)">2</button></td>
                  <td class="px-2.5 py-[9px]">BGE-M3 · 1024 维 · pgvector(ivfflat)</td>
                  <td class="px-2.5 py-[9px] font-mono text-[11.5px]">rag-overview-v2.md#2</td>
                </tr>
                <tr class="shadow-[inset_0_1px_0_rgba(223,227,232,0.8)]">
                  <td class="px-2.5 py-[9px]"><strong class="font-semibold text-[var(--color-ink-1)]">eval</strong><button class="ml-1 inline-grid h-4 min-w-4 place-items-center rounded-[5px] border-0 bg-[var(--color-brand-soft)] px-1 font-mono text-[10px] font-semibold text-[var(--color-brand-deep)]" @click="openSource(3)">3</button></td>
                  <td class="px-2.5 py-[9px]">RAGAS · hit@5 = 0.86 · cost ↓ 41%</td>
                  <td class="px-2.5 py-[9px] font-mono text-[11.5px]">rag-overview-v2.md#3</td>
                </tr>
              </tbody>
            </table>
          </div>
          <template #tick>delivered · 3 引用</template>
        </ChatMessage>
      </div>

      <!-- composer -->
      <Composer
        placeholder="告诉 Terry 你接下来要做的事…"
        scope-label="Workspace: 全部启用"
        send-label="发送"
        hint="调出工具 · @ 切换 agent"
        model-value="把刚才那三块的速查表导成一张网页，配色跟参考截图走。"
        @send="onSend"
      >
        <template #tools>
          <button class="grid h-[30px] w-[30px] place-items-center rounded-[9px] border-0 bg-transparent text-[var(--color-brand)] transition-colors hover:bg-[var(--color-hover)]" aria-label="附件"><AppIcon name="paperclip" :size="16" :stroke-width="2" /></button>
          <button class="grid h-[30px] w-[30px] place-items-center rounded-[9px] border-0 bg-transparent text-[var(--color-ink-2)] transition-colors hover:bg-[var(--color-hover)] hover:text-[var(--color-ink-1)]" aria-label="图片"><AppIcon name="image" :size="16" :stroke-width="2" /></button>
          <button class="grid h-[30px] w-[30px] place-items-center rounded-[9px] border-0 bg-transparent text-[var(--color-ink-2)] transition-colors hover:bg-[var(--color-hover)] hover:text-[var(--color-ink-1)]" aria-label="工具"><AppIcon name="wrench" :size="16" :stroke-width="2" /></button>
          <button class="grid h-[30px] w-[30px] place-items-center rounded-[9px] border-0 bg-transparent text-[var(--color-ink-2)] transition-colors hover:bg-[var(--color-hover)] hover:text-[var(--color-ink-1)]" aria-label="语音"><AppIcon name="mic" :size="16" :stroke-width="2" /></button>
        </template>
        <template #footer-left><span>· sandbox safe</span></template>
        <template #statbar>
          <span class="inline-flex items-center gap-1.5 before:h-[5px] before:w-[5px] before:rounded-full before:bg-[var(--color-brand)] before:content-['']">deepseek-chat</span>
          <span class="inline-flex items-center gap-1.5 before:h-[5px] before:w-[5px] before:rounded-full before:bg-[#9FCADB] before:content-['']">5 工具 · 3 memory</span>
          <span class="inline-flex items-center gap-1.5 before:h-[5px] before:w-[5px] before:rounded-full before:bg-[var(--color-ok)] before:content-['']">护栏 v2.1 已启用</span>
        </template>
      </Composer>

    </section>

    <!-- AI 实时思考侧栏（仅对话模块） -->
    <ThinkingPanel :steps="runningTrace" />
    </div>

    <SourceDrawer
      :open="drawerOpen"
      :sources="sources"
      :hot-idx="drawerHot"
      sub="pgvector · top 4 · 命中 3 段"
      @close="drawerOpen = false"
    />
  </main>
</template>
