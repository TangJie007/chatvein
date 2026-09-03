<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: 'default' | 'primary' | 'ghost'
    size?: 'sm' | 'md'
  }>(),
  { variant: 'default', size: 'md' },
)
</script>

<template>
  <button
    type="button"
    class="inline-flex items-center justify-center gap-[7px] rounded-[11px] border-0 font-semibold transition-all duration-200 ease-[var(--ease-soft)] focus-visible:outline-2 focus-visible:outline-[var(--color-brand)] focus-visible:outline-offset-2"
    :class="[
      size === 'sm' ? 'px-[11px] py-1.5 text-xs rounded-[9px]' : 'px-[15px] py-[9px] text-[12.5px]',
      variant === 'primary'
        ? 'text-white shadow-[var(--shadow-brand)] bg-[linear-gradient(180deg,var(--color-brand-lite),var(--color-brand-solid))] hover:-translate-y-px hover:text-white'
        : variant === 'ghost'
          ? 'bg-transparent text-[var(--color-ink-2)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink-1)]'
          : 'bg-[var(--color-input)] text-[var(--color-ink-2)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink-1)]',
    ]"
  >
    <slot />
  </button>
</template>
