<script setup lang="ts">
import type { AvatarTint } from '../../data/types'
import Avatar from '../ui/Avatar.vue'

withDefaults(
  defineProps<{
    role: 'user' | 'agent'
    initial: string
    tint?: AvatarTint
    author?: string
    roleMini?: string
    time?: string
    /** 纯文本内容；有 slot 时 slot 优先 */
    content?: string
    /** 助手回复的 token 用量文案，展示在时间旁 */
    tokenLabel?: string
    tokenTitle?: string
  }>(),
  {
    tint: 'indigo',
    author: '',
    roleMini: '',
    time: '',
    content: '',
    tokenLabel: '',
    tokenTitle: '',
  },
)
</script>

<template>
  <div
    class="flex max-w-[88%] items-end gap-3"
    :class="role === 'user' ? 'ml-auto flex-row-reverse' : ''"
  >
    <div
      class="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] text-xs font-semibold text-white shadow-[0_2px_6px_rgb(43_44_48/0.10),inset_0_1px_0_rgb(255_255_255/0.30)]"
      :class="tint === 'sky' ? 'bg-[linear-gradient(135deg,#B7DCE8,#7FB3C9)]' : tint === 'teal' ? 'bg-[linear-gradient(135deg,#A1CEC8,#6FAE9F)]' : 'bg-[linear-gradient(135deg,#8496D8,#5A6FCB)]'"
    >
      {{ initial }}
    </div>

    <div class="min-w-0" :class="role === 'user' ? 'flex flex-col items-end' : ''">
      <div v-if="role === 'agent' && author" class="mb-[5px] flex items-center gap-1.5 text-[11.5px] font-semibold text-[var(--color-ink-2)]">
        <span>{{ author }}</span>
        <span v-if="roleMini" class="rounded-[5px] bg-[var(--color-track)] px-1.5 py-0.5 font-mono text-[10px] font-medium text-[var(--color-ink-3)]">{{ roleMini }}</span>
        <span v-if="time" class="font-mono text-[10.5px] font-normal text-[var(--color-ink-3)]">{{ time }}</span>
        <span
          v-if="tokenLabel"
          class="font-mono text-[10.5px] font-normal text-[var(--color-ink-3)]"
          :title="tokenTitle || undefined"
        >· {{ tokenLabel }}</span>
      </div>

      <div
        class="px-[15px] py-[11px] text-sm leading-[1.55] shadow-[var(--shadow-1)]"
        :class="
          role === 'user'
            ? 'rounded-[var(--radius-bubble)] rounded-br-[6px] text-white shadow-[var(--shadow-brand)] bg-[linear-gradient(135deg,#6C81D2,#4A5FBB)]'
            : 'rounded-[var(--radius-bubble)] rounded-bl-[6px] bg-[var(--color-elevated)] text-[var(--color-ink-1)]'
        "
      >
        <slot>
          <div class="whitespace-pre-wrap break-words">{{ content }}</div>
        </slot>
        <div
          v-if="time && role === 'user'"
          class="mt-2 inline-flex items-center gap-1 font-mono text-[11px] font-medium uppercase tracking-[0.4px]"
          :class="role === 'user' ? 'text-white/[0.82]' : 'text-[var(--color-ink-3)]'"
        >
          <span v-if="$slots.tick"><slot name="tick" /></span>
          <span v-else>✓ 已发送 · {{ time }}</span>
        </div>
        <div
          v-if="time && role === 'agent' && $slots.tick"
          class="mt-2 inline-flex items-center gap-1 font-mono text-[11px] font-medium uppercase tracking-[0.4px] text-[var(--color-ink-3)]"
        >
          <slot name="tick" />
        </div>
      </div>
    </div>
  </div>
</template>
