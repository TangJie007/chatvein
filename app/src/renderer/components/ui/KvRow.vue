<script setup lang="ts">
defineProps<{ k: string; sub?: string; mono?: boolean }>()
</script>

<template>
  <div class="flex items-center justify-between gap-4 py-[9px] shadow-[inset_0_1px_0_rgba(223,227,232,0.8)] [&:first-child]:shadow-none">
    <div class="text-[12.5px] font-medium text-[var(--color-ink-2)]">
      {{ k }}
      <small v-if="sub" class="mt-0.5 block text-[11px] font-normal text-[var(--color-ink-3)]">{{ sub }}</small>
    </div>
    <div class="shrink-0 text-right text-[12.5px] font-medium text-[var(--color-ink-1)]" :class="mono ? 'font-mono text-xs' : ''">
      <slot />
    </div>
  </div>
</template>
