<script setup lang="ts">
defineProps<{ modelValue?: string; options: Array<{ value: string; label: string }> }>()
const emit = defineEmits<{ 'update:modelValue': [string] }>()
</script>

<template>
  <select
    :value="modelValue"
    class="w-full cursor-pointer appearance-none rounded-[11px] border-0 bg-[var(--color-input)] bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20width=%2712%27%20height=%2712%27%20viewBox=%270%200%2024%2024%27%20fill=%27none%27%20stroke=%27%236F6668%27%20stroke-width=%272.6%27%20stroke-linecap=%27round%27%20stroke-linejoin=%27round%27%3E%3Cpath%20d=%27M6%209l6%206%206-6%27/%3E%3C/svg%3E')] bg-[position:right_11px_center] bg-no-repeat py-[9px] pl-3 pr-[30px] text-[13px] text-[var(--color-ink-1)] transition-all focus:bg-[#F7F8FA] focus:shadow-[0_0_0_4px_rgb(97_120_208/0.16)] focus:outline-none"
    @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
  >
    <option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option>
  </select>
</template>
