<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: 'default' | 'primary' | 'ghost' | 'danger'
    size?: 'sm' | 'md'
    disabled?: boolean
  }>(),
  { variant: 'default', size: 'md', disabled: false },
)
</script>

<template>
  <button
    type="button"
    :disabled="disabled"
    class="inline-flex items-center justify-center gap-[7px] rounded-[11px] border-0 font-semibold transition-all duration-200 ease-[var(--ease-soft)] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:translate-y-0"
    :class="[
      size === 'sm' ? 'px-[11px] py-1.5 text-xs rounded-[9px]' : 'px-[15px] py-[9px] text-[12.5px]',
      variant === 'primary'
        ? 'text-white shadow-[var(--shadow-brand)] bg-[linear-gradient(180deg,var(--color-brand-lite),var(--color-brand-solid))] hover:-translate-y-px hover:text-white focus-visible:outline-[var(--color-brand)]'
        : variant === 'danger'
          ? 'text-white bg-[var(--color-danger)] shadow-[0_4px_14px_rgb(248_101_118/0.35)] hover:brightness-[0.96] focus-visible:outline-[var(--color-danger)]'
          : variant === 'ghost'
            ? 'bg-transparent text-[var(--color-ink-2)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink-1)] focus-visible:outline-[var(--color-brand)]'
            : 'bg-[var(--color-input)] text-[var(--color-ink-2)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink-1)] focus-visible:outline-[var(--color-brand)]',
    ]"
  >
    <slot />
  </button>
</template>
