<script setup lang="ts">
defineProps<{ title: string }>()
</script>

<template>
  <div
    class="relative overflow-hidden rounded-[15px] px-3 pb-3 pt-[11px]"
    style="
      background: linear-gradient(180deg, var(--color-brand-soft), rgb(240 242 251 / 0.5));
      box-shadow: inset 0 0 0 1px rgb(97 120 208 / 0.14);
    "
  >
    <div
      class="pointer-events-none absolute -right-[26px] -top-[26px] h-[84px] w-[84px] rounded-full"
      style="background: radial-gradient(circle, rgb(132 150 216 / 0.45), transparent 70%)"
    />
    <h5 class="relative m-0 mb-1.5 flex items-center gap-1.5 text-[11.5px] font-semibold text-[var(--color-brand-dark)]">
      <slot name="icon" />
      {{ title }}
    </h5>
    <p class="relative m-0 text-[11.5px] leading-[1.55] text-[var(--color-ink-2)]">
      <slot />
    </p>
  </div>
</template>
