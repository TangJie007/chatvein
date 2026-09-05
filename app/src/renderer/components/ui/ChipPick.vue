<script setup lang="ts">
import { Switch } from '@headlessui/vue'

defineProps<{ modelValue: boolean; value?: string }>()
const emit = defineEmits<{ 'update:modelValue': [boolean] }>()
</script>

<template>
  <Switch
    :model-value="modelValue"
    class="inline-flex items-center gap-1.5 rounded-full border-0 px-[11px] py-1.5 text-xs font-medium transition-colors duration-200 ease-[var(--ease-soft)] focus-visible:outline-2 focus-visible:outline-[var(--color-brand)] focus-visible:outline-offset-2"
    :class="
      modelValue
        ? 'bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]'
        : 'bg-[var(--color-track)] text-[var(--color-ink-2)] hover:bg-[var(--color-hover)]'
    "
    @update:model-value="emit('update:modelValue', $event)"
  >
    <span
      aria-hidden="true"
      class="grid h-[13px] w-[13px] place-items-center rounded text-[9px] font-bold transition-colors duration-200"
      :class="modelValue ? 'bg-[var(--color-brand)] text-white' : 'bg-[var(--color-hover)] text-transparent'"
      >✓</span
    >
    <span><slot /></span>
  </Switch>
</template>
