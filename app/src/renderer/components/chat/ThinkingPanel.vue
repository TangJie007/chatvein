<script setup lang="ts">
import AppIcon from '../AppIcon.vue'
import type { TraceStep } from './AgentTrace.vue'

withDefaults(
  defineProps<{
    steps?: TraceStep[]
    thought?: string
    meta?: string
  }>(),
  {
    steps: () => [],
    thought: '',
    meta: 'tokens 1.2k · 2.4s · ¥0.003',
  },
)
</script>

<template>
  <aside
    class="flex h-full min-h-0 w-[240px] shrink-0 flex-col bg-[var(--color-elevated)] shadow-[inset_1px_0_0_rgba(223,227,232,0.8)]"
    aria-label="AI 思考过程"
  >
    <!-- header -->
    <div class="flex items-center gap-2 px-4 pb-3 pt-[18px]">
      <span class="h-[7px] w-[7px] shrink-0 rounded-full bg-[var(--color-brand)] dot-thinking" />
      <div class="min-w-0">
        <div class="text-[13px] font-semibold leading-tight text-[var(--color-ink-1)]">思考流</div>
        <div class="mt-[2px] truncate font-mono text-[10.5px] text-[var(--color-ink-3)]">
          Terry · 第 3 / 5 步
        </div>
      </div>
      <span
        class="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--color-brand-soft)] px-2 py-[3px] font-mono text-[10px] font-semibold uppercase tracking-[0.4px] text-[var(--color-brand-dark)]"
      >
        <span class="h-[5px] w-[5px] rounded-full bg-[var(--color-brand)] dot-thinking" />
        live
      </span>
    </div>

    <!-- body -->
    <div class="scroll-thin flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3.5 pb-3">
      <div class="px-1 pt-1 font-mono text-[10px] font-semibold uppercase tracking-[0.6px] text-[var(--color-ink-3)]">
        当前想法
      </div>

      <p
        class="m-0 rounded-[14px] bg-[var(--color-track)] px-3 py-2.5 text-[12px] leading-[1.65] text-[var(--color-ink-2)] shadow-[inset_0_0_0_1px_rgba(223,227,232,0.7)]"
      >
        {{
          thought
          || '三个模块要落进 Obsidian：先在 ~/notes 定位昨天的 RAG 笔记，按语义边界切块；目标文件已存在，用户选择 v2 重写 + 旧版备份。下一步：备份 → 写入 → 校验 wikilink 索引。'
        }}
      </p>

      <div class="px-1 pt-2 font-mono text-[10px] font-semibold uppercase tracking-[0.6px] text-[var(--color-ink-3)]">
        行动轨迹
      </div>

      <div
        v-for="(s, i) in steps"
        :key="i"
        class="grid grid-cols-[20px_1fr] items-start gap-2 rounded-[12px] px-2 py-2"
        :class="
          i === steps.length - 1
            ? 'bg-[var(--color-brand-soft)] shadow-[inset_0_0_0_1px_rgb(97_120_208/0.28)]'
            : ''
        "
      >
        <div
          class="mt-[1px] grid h-[20px] w-[20px] shrink-0 place-items-center rounded-[6px] font-mono text-[10px] font-semibold"
          :class="
            s.kind === 'ok'
              ? 'bg-[#7fbfa8]/[0.18] text-[var(--color-ok-ink)]'
              : s.kind === 'tool'
                ? 'bg-[#6c81d2]/[0.16] text-[var(--color-info-ink)]'
                : 'bg-[var(--color-hover)] text-[var(--color-brand-deep)]'
          "
        >
          <AppIcon v-if="i === steps.length - 1" name="activity" :size="11" :stroke-width="2.2" />
          <template v-else>{{ s.icon }}</template>
        </div>
        <div class="min-w-0">
          <div class="flex items-center gap-1.5">
            <span class="truncate font-mono text-[11px] font-semibold text-[var(--color-ink-1)]">{{ s.name }}</span>
            <span class="ml-auto shrink-0 font-mono text-[10px] text-[var(--color-ink-3)]">{{ s.tag }}</span>
          </div>
          <p class="m-0 mt-[3px] text-[11.5px] leading-[1.5] text-[var(--color-ink-2)]">{{ s.detail }}</p>
        </div>
      </div>
    </div>

    <!-- footer -->
    <div class="shrink-0 px-4 pb-3.5 pt-2.5 shadow-[inset_0_1px_0_rgba(223,227,232,0.8)]">
      <div class="flex items-center justify-between font-mono text-[10px] text-[var(--color-ink-3)]">
        <span>上下文 8.2k / 128k</span>
        <span>6%</span>
      </div>
      <div class="mt-1.5 h-[3px] overflow-hidden rounded-full bg-[var(--color-track)]">
        <div class="h-full w-[6%] rounded-full bg-[var(--color-brand-lite)]" />
      </div>
      <div class="mt-2 truncate font-mono text-[10.5px] text-[var(--color-ink-3)]">{{ meta }}</div>
    </div>
  </aside>
</template>
