<script setup lang="ts">
defineProps<{ idx?: string | number; side?: string; title?: string }>()
</script>

<template>
  <section class="rounded-[var(--radius-card)] bg-[var(--color-elevated)] p-4 px-[18px] shadow-[var(--shadow-1)]">
    <header v-if="$slots.header || title" class="mb-3.5 flex items-center justify-between gap-3">
      <slot name="header">
        <h4 class="m-0 flex items-center gap-2 text-[13px] font-semibold text-[var(--color-ink-1)]">
          <span
            v-if="idx !== undefined"
            class="grid h-5 w-5 place-items-center rounded-[7px] bg-[var(--color-brand-soft)] font-mono text-[11px] font-semibold text-[var(--color-brand-deep)]"
            >{{ idx }}</span
          >
          {{ title }}
        </h4>
      </slot>
      <span v-if="side" class="font-mono text-[11px] font-medium text-[var(--color-ink-3)]">{{ side }}</span>
    </header>
    <slot />
  </section>
</template>
