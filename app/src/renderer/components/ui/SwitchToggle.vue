<script setup lang="ts">
import { Switch } from '@headlessui/vue'

defineProps<{ modelValue: boolean; label?: string }>()
const emit = defineEmits<{ 'update:modelValue': [boolean] }>()
</script>

<template>
  <Switch
    :model-value="modelValue"
    :class="modelValue ? 'bg-[var(--color-brand-solid)]' : 'bg-[var(--color-hover)]'"
    class="relative inline-flex h-[22px] w-[38px] shrink-0 cursor-pointer items-center rounded-full border-0 p-0 transition-colors duration-200 ease-[var(--ease-soft)] focus-visible:outline-2 focus-visible:outline-[var(--color-brand)] focus-visible:outline-offset-2"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <span class="sr-only">{{ label || '开关' }}</span>
    <span
      aria-hidden="true"
      class="pointer-events-none absolute left-[3px] top-[3px] h-4 w-4 rounded-full bg-white shadow-[0_1px_3px_rgb(43_44_48/0.22)] transition-transform duration-200 ease-[var(--ease-soft)]"
      :class="modelValue ? 'translate-x-4' : 'translate-x-0'"
    />
  </Switch>
</template>
