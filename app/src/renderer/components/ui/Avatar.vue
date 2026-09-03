<script setup lang="ts">
import { computed } from 'vue'
import type { AvatarTint, DotState } from '../../data/types'

const props = withDefaults(
  defineProps<{
    initial: string
    tint?: AvatarTint
    size?: 'sm' | 'md' | 'lg'
    dot?: DotState
  }>(),
  { tint: 'indigo', size: 'md', dot: 'none' },
)

const sizeClass = computed(() => {
  if (props.size === 'lg') return 'w-[46px] h-[46px] rounded-[14px] text-base'
  if (props.size === 'sm') return 'w-[26px] h-[26px] rounded-lg text-[10.5px]'
  return 'w-[34px] h-[34px] rounded-[11px] text-[13px]'
})

// gradient map (Tailwind arbitrary values keep these tree-shaken-safe)
const tintClass: Record<AvatarTint, string> = {
  indigo: 'bg-[linear-gradient(135deg,#8496D8,#5A6FCB)]',
  sky: 'bg-[linear-gradient(135deg,#B7DCE8,#7FB3C9)]',
  peach: 'bg-[linear-gradient(135deg,#E9C5B1,#D29880)]',
  clay: 'bg-[linear-gradient(135deg,#D6A985,#B57E58)]',
  rose: 'bg-[linear-gradient(135deg,#FB8E9B,#E44E60)]',
  slate: 'bg-[linear-gradient(135deg,#BCC6D3,#8E9AA9)]',
  teal: 'bg-[linear-gradient(135deg,#A1CEC8,#6FAE9F)]',
  violet: 'bg-[linear-gradient(135deg,#C3B9E8,#8E7FCB)]',
}

const dotColor: Record<DotState, string> = {
  online: 'bg-[var(--color-ok)]',
  thinking: 'bg-[var(--color-brand)] dot-thinking',
  idle: 'bg-[var(--color-ink-3)]',
  err: 'bg-[var(--color-danger)]',
  none: '',
}

const dotSize = computed(() =>
  props.size === 'lg' ? 'w-3 h-3' : props.size === 'sm' ? 'w-2 h-2' : 'w-2.5 h-2.5',
)
</script>

<template>
  <div
    class="relative grid shrink-0 place-items-center rounded-[11px] font-semibold text-white shadow-[0_2px_6px_rgb(43_44_48/0.10),inset_0_1px_0_rgb(255_255_255/0.30)]"
    :class="[sizeClass, tintClass[tint]]"
  >
    {{ initial }}
    <span
      v-if="dot !== 'none'"
      class="absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-[var(--color-canvas)]"
      :class="[dotSize, dotColor[dot]]"
    />
  </div>
</template>
