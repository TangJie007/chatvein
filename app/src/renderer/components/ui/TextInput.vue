<script setup lang="ts">
withDefaults(
  defineProps<{
    modelValue?: string
    mono?: boolean
    placeholder?: string
    type?: string
    list?: string
  }>(),
  {
    modelValue: '',
    mono: false,
    placeholder: '',
    type: 'text',
    list: undefined,
  },
)
const emit = defineEmits<{ 'update:modelValue': [string] }>()
</script>

<template>
  <input
    :type="type"
    :value="modelValue"
    :placeholder="placeholder"
    :list="list"
    class="w-full rounded-[11px] border-0 bg-[var(--color-input)] px-3 py-[9px] text-[13px] text-[var(--color-ink-1)] transition-all placeholder:text-[var(--color-ink-3)] focus:bg-[#F7F8FA] focus:shadow-[0_0_0_4px_rgb(97_120_208/0.16)] focus:outline-none"
    :class="mono ? 'font-mono text-xs' : ''"
    style="user-select: text; -webkit-user-select: text"
    @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
  />
</template>
