<script setup lang="ts">
withDefaults(defineProps<{ modelValue?: string; mono?: boolean; placeholder?: string }>(), {
  modelValue: '',
  mono: false,
  placeholder: '',
})
const emit = defineEmits<{ 'update:modelValue': [string] }>()
</script>

<template>
  <textarea
    :value="modelValue"
    :placeholder="placeholder"
    spellcheck="false"
    class="w-full resize-y rounded-[11px] border-0 bg-[var(--color-input)] px-3 py-[9px] text-[13px] leading-[1.6] text-[var(--color-ink-1)] transition-all placeholder:text-[var(--color-ink-3)] focus:bg-[#F7F8FA] focus:shadow-[0_0_0_4px_rgb(97_120_208/0.16)] focus:outline-none"
    :class="mono ? 'min-h-[108px] font-mono text-xs' : 'min-h-[108px]'"
    @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
  />
</template>
