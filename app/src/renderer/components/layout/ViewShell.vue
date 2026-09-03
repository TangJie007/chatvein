<script setup lang="ts">
defineProps<{ footNote?: string }>()
</script>

<template>
  <section class="grid h-full min-h-0 grid-rows-[auto_1fr_auto]">
    <header class="flex items-center justify-between gap-4 px-[26px] pb-3.5 pt-4">
      <div class="flex min-w-0 items-center gap-3">
        <slot name="identity" />
      </div>
      <div class="flex shrink-0 items-center gap-1.5">
        <slot name="actions" />
      </div>
    </header>

    <div class="scroll-thin flex min-h-0 flex-col gap-4 overflow-y-auto px-[26px] pb-5">
      <slot />
    </div>

    <footer
      v-if="$slots.footer || footNote"
      class="flex items-center justify-between gap-3 px-[26px] pb-4 pt-3"
      style="background: linear-gradient(180deg, transparent, rgb(245 246 248 / 0.9))"
    >
      <span v-if="footNote" class="font-mono text-[11.5px] font-medium text-[var(--color-ink-3)]">{{ footNote }}</span>
      <slot name="footer" />
    </footer>
  </section>
</template>
