<script setup lang="ts">
import type { AvatarTint } from '../../data/types'
import Avatar from '../ui/Avatar.vue'

defineProps<{ items: Array<{ initial: string; tint: AvatarTint }>; more?: number }>()
</script>

<template>
  <div class="flex items-center">
    <div
      v-for="(a, i) in items"
      :key="i"
      :style="i === 0 ? '' : 'margin-left: -9px'"
      class="rounded-[11px] shadow-[0_0_0_2.5px_var(--color-canvas),0_2px_5px_rgb(43_44_48/0.12)]"
    >
      <Avatar :initial="a.initial" :tint="a.tint" size="sm" />
    </div>
    <div
      v-if="more"
      class="grid h-[34px] w-[34px] place-items-center rounded-[11px] bg-[var(--color-hover)] font-mono text-[11px] font-semibold text-[var(--color-ink-2)]"
      style="margin-left: -9px; box-shadow: 0 0 0 2.5px var(--color-canvas)"
    >
      +{{ more }}
    </div>
  </div>
</template>
