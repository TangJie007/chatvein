<script setup lang="ts">
defineProps<{ title: string }>()
</script>

<template>
  <div class="flex items-center justify-between px-1 pb-0 pt-0.5">
    <h4 class="m-0 text-[10.5px] font-semibold uppercase tracking-[0.7px] text-[var(--color-ink-3)]">
      {{ title }}
    </h4>
  </div>
</template>
