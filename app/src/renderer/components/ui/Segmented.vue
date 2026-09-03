<script setup lang="ts" generic="T extends string">
defineProps<{ modelValue: T; options: T[] }>()
const emit = defineEmits<{ 'update:modelValue': [T] }>()
</script>

<template>
  <div class="inline-flex gap-0.5 rounded-[10px] bg-[var(--color-input)] p-[3px]" role="tablist">
    <button
      v-for="opt in options"
      :key="opt"
      type="button"
      role="tab"
      :aria-selected="modelValue === opt"
      class="rounded-[7px] border-0 bg-transparent px-3 py-1.5 text-xs font-medium transition-colors duration-200 ease-[var(--ease-soft)] focus-visible:outline-2 focus-visible:outline-[var(--color-brand)] focus-visible:outline-offset-1"
      :class="modelValue === opt ? 'bg-[var(--color-elevated)] text-[var(--color-ink-1)] shadow-[0_1px_3px_rgb(43_44_48/0.08)]' : 'text-[var(--color-ink-2)]'"
      @click="emit('update:modelValue', opt)"
    >
      {{ opt }}
    </button>
  </div>
</template>
