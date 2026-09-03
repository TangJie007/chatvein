<script setup lang="ts">
import AppIcon from '../AppIcon.vue'

export interface SourceItem {
  idx: number
  file: string
  score: string
  text: string
  dim?: boolean
}

defineProps<{ open: boolean; title?: string; sub?: string; sources: SourceItem[]; hotIdx?: number | null }>()
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <div
    class="absolute inset-0 z-[4] bg-[rgb(43_44_48/0.16)] opacity-0 backdrop-blur-[2px] transition-opacity duration-300"
    :class="open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'"
    @click="emit('close')"
  />
  <aside
    class="absolute bottom-0 right-0 top-0 z-[5] flex w-[352px] max-w-[92%] flex-col bg-[var(--color-elevated)] shadow-[-24px_0_64px_rgb(43_44_48/0.16)] transition-transform duration-[420ms] ease-[var(--ease-quart)]"
    :class="open ? 'translate-x-0' : 'translate-x-[101%]'"
    :aria-hidden="!open"
    aria-label="引用来源"
  >
    <div class="flex items-start justify-between gap-3 px-[22px] pb-3 pt-[18px]">
      <div>
        <h3 class="m-0 mb-1 text-[15px] font-semibold text-[var(--color-ink-1)]">{{ title ?? '引用来源' }}</h3>
        <p class="m-0 font-mono text-[11.5px] text-[var(--color-ink-3)]">{{ sub }}</p>
      </div>
      <button
        class="grid h-7 w-7 shrink-0 place-items-center rounded-[9px] border-0 bg-[var(--color-track)] text-[var(--color-ink-2)] transition-colors hover:bg-[var(--color-hover)] hover:text-[var(--color-ink-1)]"
        aria-label="关闭"
        @click="emit('close')"
      >
        <AppIcon name="x" :size="14" :stroke-width="2.4" />
      </button>
    </div>
    <div class="scroll-thin flex flex-col gap-2.5 overflow-y-auto px-3.5 pb-5 pt-1">
      <article
        v-for="s in sources"
        :key="s.idx"
        class="rounded-[14px] px-3.5 py-3 transition-all duration-300"
        :class="
          hotIdx === s.idx
            ? 'bg-[var(--color-brand-soft)] shadow-[inset_0_0_0_1px_rgb(97_120_208/0.38)]'
            : 'bg-[var(--color-track)] shadow-[inset_0_0_0_1px_rgba(223,227,232,0.7)]'
        "
        :style="s.dim ? 'opacity: 0.62' : ''"
      >
        <div class="mb-[7px] flex items-center gap-2">
          <span
            class="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-md font-mono text-[10px] font-semibold text-white"
            :style="s.dim ? 'background: var(--color-ink-3)' : 'background: var(--color-brand)'"
            >{{ s.idx }}</span
          >
          <span class="truncate font-mono text-xs font-medium text-[var(--color-ink-1)]">{{ s.file }}</span>
          <span
            class="ml-auto shrink-0 rounded-full px-[7px] py-0.5 font-mono text-[10.5px] font-semibold"
            :class="s.dim ? 'bg-[var(--color-hover)] text-[var(--color-ink-3)]' : 'bg-[#7fbfa8]/[0.22] text-[var(--color-ok-ink)]'"
            >{{ s.score }}</span
          >
        </div>
        <p class="m-0 text-[12.5px] leading-[1.6] text-[var(--color-ink-2)]">{{ s.text }}</p>
      </article>
    </div>
  </aside>
</template>
