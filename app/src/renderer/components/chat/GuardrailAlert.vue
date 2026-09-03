<script setup lang="ts">
import AppIcon from '../AppIcon.vue'

defineProps<{ title: string; detail: string }>()
</script>

<template>
  <div
    class="mx-11 my-1.5 grid grid-cols-[28px_1fr_auto] items-center gap-2.5 rounded-[14px] px-3.5 py-3"
    style="
      background: linear-gradient(135deg, rgb(231 180 92 / 0.16), rgb(231 180 92 / 0.08));
      box-shadow: inset 0 0 0 1px rgb(231 180 92 / 0.38);
    "
    role="alert"
  >
    <div class="grid h-7 w-7 place-items-center rounded-[9px] bg-[var(--color-warn)] text-[#4A3608] shadow-[0_2px_6px_rgb(138_100_20/0.25)]">
      <AppIcon name="alert" :size="14" :stroke-width="2.4" />
    </div>
    <div class="text-[13px] font-medium text-[var(--color-ink-1)]">
      <strong>{{ title }}</strong>
      <small class="mt-[3px] block text-[11.5px] font-normal text-[var(--color-ink-2)]">{{ detail }}</small>
    </div>
    <div class="flex gap-1.5">
      <slot />
    </div>
  </div>
</template>
