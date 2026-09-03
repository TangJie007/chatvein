<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import {
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
} from '@headlessui/vue'

const props = withDefaults(
  defineProps<{
    modelValue?: string
    options: Array<{ value: string; label: string }>
    placeholder?: string
    disabled?: boolean
  }>(),
  {
    modelValue: '',
    placeholder: '请选择…',
    disabled: false,
  },
)

const emit = defineEmits<{ 'update:modelValue': [string] }>()

const rootRef = ref<HTMLElement | null>(null)
const panelStyle = ref<Record<string, string>>({})

const selectedLabel = computed(() => {
  const hit = props.options.find((o) => o.value === props.modelValue)
  return hit?.label ?? props.placeholder
})

const isPlaceholder = computed(() => !props.options.some((o) => o.value === props.modelValue))

function updatePosition() {
  const el = rootRef.value
  if (!el) return
  const r = el.getBoundingClientRect()
  const maxH = 260
  const gap = 6
  const spaceBelow = window.innerHeight - r.bottom - gap
  const preferUp = spaceBelow < 160 && r.top > spaceBelow
  panelStyle.value = {
    position: 'fixed',
    left: `${Math.round(r.left)}px`,
    width: `${Math.round(Math.max(r.width, 200))}px`,
    zIndex: '1200',
    maxHeight: `${maxH}px`,
    ...(preferUp
      ? { bottom: `${Math.round(window.innerHeight - r.top + gap)}px`, top: 'auto' }
      : { top: `${Math.round(r.bottom + gap)}px`, bottom: 'auto' }),
  }
}

function bindListeners(on: boolean) {
  if (on) {
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)
  } else {
    window.removeEventListener('scroll', updatePosition, true)
    window.removeEventListener('resize', updatePosition)
  }
}

async function onPanelEnter() {
  await nextTick()
  updatePosition()
  bindListeners(true)
}

function onPanelLeave() {
  bindListeners(false)
}

onBeforeUnmount(() => bindListeners(false))

function onUpdate(value: string | number | boolean | object | null) {
  emit('update:modelValue', String(value ?? ''))
}
</script>

<template>
  <Listbox
    v-slot="{ open }"
    :model-value="modelValue"
    :disabled="disabled"
    as="div"
    class="relative w-full"
    @update:model-value="onUpdate"
  >
    <div ref="rootRef" class="relative w-full">
      <ListboxButton
        class="group flex w-full items-center gap-2 rounded-[11px] border-0 bg-[var(--color-input)] py-[9px] pl-3 pr-2.5 text-left text-[13px] transition-all duration-200 ease-[var(--ease-soft)] focus:bg-[#F7F8FA] focus:shadow-[0_0_0_4px_rgb(97_120_208/0.16)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-55"
        :class="open ? 'bg-[#F7F8FA] shadow-[0_0_0_4px_rgb(97_120_208/0.16)]' : ''"
      >
        <span
          class="min-w-0 flex-1 truncate"
          :class="isPlaceholder ? 'text-[var(--color-ink-3)]' : 'text-[var(--color-ink-1)]'"
        >
          {{ selectedLabel }}
        </span>
        <span
          class="grid h-6 w-6 shrink-0 place-items-center rounded-[8px] text-[var(--color-ink-3)] transition-colors group-hover:bg-[rgba(223,227,232,0.7)] group-hover:text-[var(--color-ink-2)]"
          :class="open ? 'bg-[rgba(223,227,232,0.7)] text-[var(--color-ink-2)]' : ''"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.4"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="transition-transform duration-200 ease-[var(--ease-soft)]"
            :class="open ? 'rotate-180' : ''"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </span>
      </ListboxButton>
    </div>

    <Teleport to="body">
      <Transition
        enter-active-class="transition duration-150 ease-[var(--ease-soft)]"
        enter-from-class="opacity-0 -translate-y-0.5 scale-[0.98]"
        enter-to-class="opacity-100 translate-y-0 scale-100"
        leave-active-class="transition duration-100 ease-in"
        leave-from-class="opacity-100 translate-y-0 scale-100"
        leave-to-class="opacity-0 -translate-y-0.5 scale-[0.98]"
        @before-enter="onPanelEnter"
        @after-leave="onPanelLeave"
      >
        <ListboxOptions
          class="scroll-thin origin-top overflow-auto rounded-[14px] bg-[var(--color-elevated)] p-1.5 shadow-[var(--shadow-3)] outline-none ring-1 ring-[rgba(165,177,193,0.28)]"
          :style="panelStyle"
        >
          <ListboxOption
            v-for="o in options"
            :key="o.value === '' ? '__empty__' : o.value"
            v-slot="{ active, selected }"
            :value="o.value"
            as="template"
          >
            <li
              class="relative flex cursor-pointer list-none items-center gap-2 rounded-[10px] px-2.5 py-2 text-[13px] transition-colors"
              :class="[
                active ? 'bg-[var(--color-brand-mist)] text-[var(--color-brand-deep)]' : 'text-[var(--color-ink-1)]',
                selected && !active ? 'bg-[var(--color-brand-soft)]' : '',
              ]"
            >
              <span
                class="min-w-0 flex-1 truncate"
                :class="selected ? 'font-semibold' : 'font-medium'"
              >
                {{ o.label }}
              </span>
              <span
                v-if="selected"
                class="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[var(--color-brand-solid)] text-white shadow-[var(--shadow-brand)]"
              >
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="3"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M5 13l4 4L19 7" />
                </svg>
              </span>
            </li>
          </ListboxOption>
          <li
            v-if="!options.length"
            class="list-none px-2.5 py-3 text-center text-xs text-[var(--color-ink-3)]"
          >
            暂无选项
          </li>
        </ListboxOptions>
      </Transition>
    </Teleport>
  </Listbox>
</template>
