<script setup lang="ts">
defineProps<{ active?: boolean }>()
</script>

<template>
  <div
    role="button"
    tabindex="0"
    class="grid w-full cursor-pointer grid-cols-[34px_1fr_auto] items-center gap-2.5 rounded-[14px] border-0 px-2.5 py-2 text-left transition-colors duration-200 outline-none focus-visible:outline-2 focus-visible:outline-[var(--color-brand)] focus-visible:outline-offset-1"
    :class="active ? 'shadow-[inset_0_0_0_1px_rgb(97_120_208/0.2)]' : 'hover:bg-[var(--color-hover)]'"
    :style="active ? 'background: linear-gradient(180deg, var(--color-brand-mist), rgb(233 236 249 / 0.55))' : ''"
    @keydown.enter.prevent="($event.currentTarget as HTMLElement).click()"
    @keydown.space.prevent="($event.currentTarget as HTMLElement).click()"
  >
    <slot name="leading" />
    <div class="min-w-0">
      <slot name="body" />
    </div>
    <div class="flex flex-col items-end gap-[3px]">
      <slot name="meta" />
    </div>
  </div>
</template>
