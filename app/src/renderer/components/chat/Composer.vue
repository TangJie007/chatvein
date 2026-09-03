<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import AppIcon from '../AppIcon.vue'

const props = defineProps<{
  placeholder: string
  scopeLabel: string
  sendLabel: string
  hint?: string
  modelValue?: string
  disabled?: boolean
}>()
const emit = defineEmits<{ send: [string]; 'update:modelValue': [string] }>()

const text = ref(props.modelValue ?? '')
const ta = ref<HTMLTextAreaElement | null>(null)

watch(
  () => props.modelValue,
  (v) => {
    if (v !== undefined && v !== text.value) text.value = v
  },
)

function autosize() {
  const el = ta.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 180)}px`
}

function onInput(e: Event) {
  const el = e.target as HTMLTextAreaElement
  text.value = el.value
  autosize()
  emit('update:modelValue', text.value)
}

function send() {
  if (props.disabled) return
  const value = text.value.trim()
  if (!value) return
  emit('send', value)
  text.value = ''
  emit('update:modelValue', '')
  void nextTick(autosize)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    send()
  }
}
</script>

<template>
  <div class="px-[22px] pb-4 pt-3" style="background: linear-gradient(180deg, transparent, rgb(245 246 248 / 0.85))">
    <div
      class="rounded-[20px] bg-[var(--color-elevated)] px-3 pb-2.5 pt-3 transition-shadow duration-200 focus-within:shadow-[0_1px_2px_rgb(43_44_48/0.06),0_12px_32px_rgb(43_44_48/0.08),0_0_0_5px_rgb(97_120_208/0.22)]"
      style="box-shadow: 0 1px 2px rgb(43 44 48 / 0.04), 0 8px 24px rgb(43 44 48 / 0.06), 0 0 0 4px rgb(97 120 208 / 0.1)"
    >
      <div class="flex items-center gap-1 px-0.5 pb-2">
        <slot name="tools">
          <button class="tool-btn text-[var(--color-brand)]" aria-label="附件">
            <AppIcon name="paperclip" :size="16" :stroke-width="2" />
          </button>
        </slot>
        <div v-if="hint" class="ml-auto font-mono text-[11.5px] font-medium text-[var(--color-ink-3)]">
          <kbd class="rounded-md bg-[var(--color-input)] px-1.5 py-0.5 font-mono text-[10.5px] text-[var(--color-ink-2)]">/</kbd>
          {{ hint }}
        </div>
      </div>

      <textarea
        ref="ta"
        :value="text"
        :placeholder="placeholder"
        :disabled="disabled"
        rows="1"
        class="w-full resize-none border-0 bg-transparent px-1.5 pt-0.5 text-sm leading-[1.45] text-[var(--color-ink-1)] placeholder:text-[var(--color-ink-3)] focus:outline-none disabled:opacity-60"
        style="min-height: 46px; max-height: 180px"
        @input="onInput"
        @keydown="onKeydown"
      />

      <div class="flex items-center justify-between px-1 pt-1.5">
        <div class="flex items-center gap-1.5 font-mono text-[11.5px] font-medium text-[var(--color-ink-3)]">
          <span class="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-brand-soft)] px-2.5 py-[3px] text-[var(--color-brand-dark)]">
            <span class="h-[5px] w-[5px] rounded-full bg-[var(--color-brand)] shadow-[0_0_0_3px_rgb(97_120_208/0.25)]" />
            {{ scopeLabel }}
          </span>
          <slot name="footer-left" />
        </div>
        <button
          type="button"
          class="inline-flex items-center gap-2 rounded-xl border-0 px-4 py-2 text-[13px] font-semibold text-white shadow-[var(--shadow-brand)] transition-all duration-200 hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:translate-y-0"
          style="background: linear-gradient(180deg, var(--color-brand-lite), var(--color-brand-solid))"
          :disabled="disabled"
          @click="send"
        >
          {{ sendLabel }}
          <AppIcon name="send" :size="14" :stroke-width="2.4" />
        </button>
      </div>
    </div>

    <div v-if="$slots.statbar" class="flex gap-3.5 px-2.5 pt-2.5 font-mono text-[11px] font-medium tracking-[0.3px] text-[var(--color-ink-3)]">
      <slot name="statbar" />
    </div>
  </div>
</template>

<style scoped>
.tool-btn {
  width: 30px;
  height: 30px;
  border-radius: 9px;
  border: none;
  background: transparent;
  display: grid;
  place-items: center;
  cursor: pointer;
  color: var(--color-ink-2);
  transition:
    background 180ms var(--ease-soft),
    color 180ms var(--ease-soft);
}
.tool-btn:hover {
  background: var(--color-hover);
  color: var(--color-ink-1);
}
</style>
