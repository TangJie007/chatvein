<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    tone?: 'default' | 'brand' | 'ok' | 'warn' | 'danger' | 'info' | 'muted'
    sm?: boolean
  }>(),
  { tone: 'default', sm: false },
)

const toneClass = computed(() => {
  switch (props.tone) {
    case 'brand':
      return 'bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]'
    case 'ok':
      return 'bg-[#7fbfa8]/[0.22] text-[var(--color-ok-ink)]'
    case 'warn':
      return 'bg-[#e7b45c]/[0.22] text-[var(--color-warn-ink)]'
    case 'danger':
      return 'bg-[#f86576]/[0.18] text-[var(--color-danger-ink)]'
    case 'info':
      return 'bg-[#6c81d2]/[0.16] text-[var(--color-info-ink)]'
    case 'muted':
      return 'bg-[var(--color-hover)] text-[var(--color-ink-3)]'
    default:
      return 'bg-[var(--color-track)] text-[var(--color-ink-2)]'
  }
})
</script>

<template>
  <span
    class="inline-flex items-center gap-1 rounded-full font-mono font-medium tracking-[0.2px]"
    :class="[
      sm ? 'px-1.5 py-0.5 text-[10px]' : 'px-2.5 py-[3px] text-[11px]',
      toneClass,
    ]"
  >
    <slot />
  </span>
</template>
