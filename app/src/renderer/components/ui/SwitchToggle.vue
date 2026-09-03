<script setup lang="ts">
const props = defineProps<{ modelValue: boolean; label?: string }>()
const emit = defineEmits<{ 'update:modelValue': [boolean] }>()

function toggle() {
  emit('update:modelValue', !props.modelValue)
}
</script>

<template>
  <button
    type="button"
    role="switch"
    :aria-checked="modelValue"
    :aria-label="label"
    class="relative h-[22px] w-[38px] shrink-0 rounded-full border-0 p-0 transition-colors duration-200 ease-[var(--ease-soft)] focus-visible:outline-2 focus-visible:outline-[var(--color-brand)] focus-visible:outline-offset-2"
    :class="modelValue ? 'bg-[var(--color-brand-solid)]' : 'bg-[var(--color-hover)]'"
    @click="toggle"
    @keydown.enter.prevent="toggle"
    @keydown.space.prevent="toggle"
  >
    <span
      class="absolute left-[3px] top-[3px] h-4 w-4 rounded-full bg-white shadow-[0_1px_3px_rgb(43_44_48/0.22)] transition-transform duration-200 ease-[var(--ease-soft)]"
      :class="modelValue ? 'translate-x-4' : 'translate-x-0'"
    />
  </button>
</template>
