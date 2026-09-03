<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import AppIcon from '../AppIcon.vue'
import type { TraceStep } from './AgentTrace.vue'

const props = withDefaults(
  defineProps<{
    /** 本轮运行是否进行中（思考 / 出正文期间面板都挂着） */
    active?: boolean
    /** 'thinking' 推理流式中；'answering' 思考结束、正在出正文 */
    phase?: 'thinking' | 'answering'
    /** 当前发言 Agent 名 */
    agent?: string
    /** 累积的思考正文（reasoning） */
    thought?: string
    /** 行动轨迹（工具/检索步骤）；一期暂无，预留 */
    steps?: TraceStep[]
  }>(),
  {
    active: false,
    phase: 'thinking',
    agent: '',
    thought: '',
    steps: () => [],
  },
)

const bodyRef = ref<HTMLElement | null>(null)

const phaseLabel = computed(() =>
  props.phase === 'thinking' ? '思考中' : '已思考 · 生成正文',
)

// 思考文本流式追加时贴底滚动
watch(
  () => props.thought,
  async () => {
    await nextTick()
    const el = bodyRef.value
    if (el) el.scrollTop = el.scrollHeight
  },
)
</script>

<template>
  <aside
    class="flex h-full min-h-0 w-[260px] shrink-0 flex-col bg-[var(--color-elevated)] shadow-[inset_1px_0_0_rgba(223,227,232,0.8)]"
    aria-label="AI 思考过程"
  >
    <!-- header -->
    <div class="flex items-center gap-2 px-4 pb-3 pt-[18px]">
      <span
        class="h-[7px] w-[7px] shrink-0 rounded-full"
        :class="active && phase === 'thinking' ? 'bg-[var(--color-brand)] dot-thinking' : 'bg-[var(--color-ink-4)]'"
      />
      <div class="min-w-0">
        <div class="text-[13px] font-semibold leading-tight text-[var(--color-ink-1)]">思考流</div>
        <div class="mt-[2px] truncate font-mono text-[10.5px] text-[var(--color-ink-3)]">
          {{ agent || 'Agent' }} · {{ phaseLabel }}
        </div>
      </div>
      <span
        v-if="active && phase === 'thinking'"
        class="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--color-brand-soft)] px-2 py-[3px] font-mono text-[10px] font-semibold uppercase tracking-[0.4px] text-[var(--color-brand-dark)]"
      >
        <span class="h-[5px] w-[5px] rounded-full bg-[var(--color-brand)] dot-thinking" />
        live
      </span>
    </div>

    <!-- body -->
    <div ref="bodyRef" class="scroll-thin flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3.5 pb-3">
      <div class="px-1 pt-1 font-mono text-[10px] font-semibold uppercase tracking-[0.6px] text-[var(--color-ink-3)]">
        当前想法
      </div>

      <p
        class="m-0 whitespace-pre-wrap rounded-[14px] bg-[var(--color-track)] px-3 py-2.5 text-[12px] leading-[1.65] shadow-[inset_0_0_0_1px_rgba(223,227,232,0.7)]"
        :class="phase === 'answering' ? 'text-[var(--color-ink-3)]' : 'text-[var(--color-ink-2)]'"
      >
        <template v-if="thought">{{ thought }}</template>
        <span v-else-if="active" class="inline-flex items-center gap-1.5 text-[var(--color-ink-3)]">
          <span class="h-[6px] w-[6px] rounded-full bg-[var(--color-brand)] dot-thinking" />
          正在梳理思路…
        </span>
        <span v-else class="text-[var(--color-ink-3)]">发送消息后，这里会实时显示推理过程。</span>
      </p>

      <template v-if="steps.length">
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
            <AppIcon v-if="active && i === steps.length - 1" name="activity" :size="11" :stroke-width="2.2" />
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
      </template>
    </div>

    <!-- footer -->
    <div class="shrink-0 px-4 pb-3.5 pt-2.5 shadow-[inset_0_1px_0_rgba(223,227,232,0.8)]">
      <div class="truncate font-mono text-[10.5px] text-[var(--color-ink-3)]">
        <template v-if="active">
          {{ phase === 'thinking' ? '推理内容来自模型 reasoning 字段' : '思考完成，正文生成中' }}
        </template>
        <template v-else>空闲 · 等待下一轮对话</template>
      </div>
    </div>
  </aside>
</template>
