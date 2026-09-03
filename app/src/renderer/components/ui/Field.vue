<script setup lang="ts">
defineProps<{ label?: string; hint?: string }>()
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <label v-if="label" class="text-[11.5px] font-medium tracking-[0.2px] text-[var(--color-ink-2)]">{{ label }}</label>
    <slot />
    <span v-if="hint" class="text-[11px] text-[var(--color-ink-3)]">{{ hint }}</span>
  </div>
</template>
