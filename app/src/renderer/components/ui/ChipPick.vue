<script setup lang="ts">
defineProps<{ modelValue: boolean; value: string }>()
const emit = defineEmits<{ 'update:modelValue': [boolean] }>()

function toggle() {
  // parent binds :modelValue and listens via @click on wrapper or v-model
}
</script>

<template>
  <button
    type="button"
    :aria-pressed="modelValue"
    class="inline-flex items-center gap-1.5 rounded-full border-0 px-[11px] py-1.5 text-xs font-medium transition-colors duration-200 ease-[var(--ease-soft)] focus-visible:outline-2 focus-visible:outline-[var(--color-brand)] focus-visible:outline-offset-2"
    :class="
      modelValue
        ? 'bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]'
        : 'bg-[var(--color-track)] text-[var(--color-ink-2)] hover:bg-[var(--color-hover)]'
    "
    @click="emit('update:modelValue', !modelValue)"
  >
    <span
      class="grid h-[13px] w-[13px] place-items-center rounded text-[9px] font-bold transition-colors duration-200"
      :class="modelValue ? 'bg-[var(--color-brand)] text-white' : 'bg-[var(--color-hover)] text-transparent'"
      >✓</span
    >
    <slot />
  </button>
</template>
