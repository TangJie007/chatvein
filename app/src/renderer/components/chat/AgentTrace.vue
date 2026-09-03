<script setup lang="ts">
import { ref } from 'vue'
import AppIcon from '../AppIcon.vue'

export interface TraceStep {
  icon: string
  kind: 'think' | 'tool' | 'ok'
  name: string
  tag: string
  detail: string
}

const props = withDefaults(
  defineProps<{
    steps: TraceStep[]
    pill: string
    pillTone?: 'run' | 'ok' | 'warn'
    meta: string
    defaultOpen?: boolean
  }>(),
  { pillTone: 'run', defaultOpen: false },
)

const isOpen = ref(props.defaultOpen)
</script>

<template>
  <div class="ml-11 max-w-[82%]">
    <button
      type="button"
      class="flex w-full flex-wrap items-center gap-2 rounded-xl border-0 bg-[var(--color-track)] px-3 py-2 text-left font-mono text-xs font-medium text-[var(--color-ink-3)] shadow-[inset_0_0_0_1px_rgba(223,227,232,0.7)] transition-colors hover:bg-[var(--color-hover)] focus-visible:outline-2 focus-visible:outline-[var(--color-brand)] focus-visible:outline-offset-2"
      :aria-expanded="isOpen"
      @click="isOpen = !isOpen"
    >
      <AppIcon
        name="chevron"
        :size="10"
        :stroke-width="3"
        class="shrink-0 transition-transform duration-200"
        :class="isOpen ? 'rotate-90' : ''"
      />
      <span
        class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] font-mono text-[11.5px] font-medium"
        :class="
          pillTone === 'ok'
            ? 'bg-[#7fbfa8]/[0.22] text-[var(--color-ok-ink)]'
            : pillTone === 'warn'
              ? 'bg-[#e7b45c]/[0.22] text-[var(--color-warn-ink)]'
              : 'bg-[var(--color-brand-soft)] text-[var(--color-brand-dark)]'
        "
        >{{ pill }}</span
      >
      <span>{{ meta }}</span>
    </button>

    <div v-show="isOpen" class="mt-1.5 flex flex-col gap-1.5">
      <div
        v-for="(s, i) in steps"
        :key="i"
        class="grid grid-cols-[22px_1fr] items-start gap-2.5 rounded-[14px] bg-[var(--color-track)] px-3 py-2.5 shadow-[inset_0_0_0_1px_rgba(223,227,232,0.7)]"
      >
        <div
          class="grid h-[22px] w-[22px] place-items-center rounded-[7px] font-mono text-[11px] font-semibold"
          :class="
            s.kind === 'ok'
              ? 'bg-[#7fbfa8]/[0.18] text-[var(--color-ok-ink)]'
              : s.kind === 'tool'
                ? 'bg-[#6c81d2]/[0.16] text-[var(--color-info-ink)]'
                : 'bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]'
          "
        >
          {{ s.icon }}
        </div>
        <div>
          <div class="flex flex-wrap items-center gap-2">
            <span class="rounded-md bg-[var(--color-hover)] px-2 py-0.5 font-mono text-[12.5px] font-semibold text-[var(--color-ink-1)]">{{ s.name }}</span>
            <span class="font-mono text-[11px] text-[var(--color-ink-3)]">{{ s.tag }}</span>
          </div>
          <p class="m-0 mt-[5px] text-[12.5px] leading-[1.5] text-[var(--color-ink-2)]">{{ s.detail }}</p>
        </div>
      </div>
    </div>
  </div>
</template>
