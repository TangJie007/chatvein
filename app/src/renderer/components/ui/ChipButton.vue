<script setup lang="ts">
withDefaults(defineProps<{ accent?: boolean }>(), { accent: false })
</script>

<template>
  <button
    type="button"
    class="inline-flex items-center gap-1.5 rounded-full border-0 px-[11px] py-1.5 text-xs font-medium transition-colors duration-200 ease-[var(--ease-soft)] focus-visible:outline-2 focus-visible:outline-[var(--color-brand)] focus-visible:outline-offset-2"
    :class="
      accent
        ? 'bg-[var(--color-brand-soft)] text-[var(--color-brand-dark)] hover:bg-[var(--color-brand-mist)]'
        : 'bg-[var(--color-track)] text-[var(--color-ink-2)] hover:bg-[var(--color-brand-soft)] hover:text-[var(--color-brand-dark)]'
    "
  >
    <slot />
  </button>
</template>
