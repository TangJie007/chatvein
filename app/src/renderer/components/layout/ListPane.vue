<script setup lang="ts">
import AppIcon from '../AppIcon.vue'

defineProps<{ title: string; count: string | number; searchPlaceholder: string; modelValue?: string }>()
const emit = defineEmits<{ 'update:modelValue': [string]; add: [] }>()
</script>

<template>
  <aside
    class="flex min-h-0 flex-col gap-3 py-3.5 pl-3.5 pr-2.5"
    style="background: linear-gradient(180deg, rgb(251 251 252 / 0.9), rgb(235 237 240 / 0.88))"
    aria-label="列表"
  >
    <div class="flex items-center justify-between px-1">
      <h3 class="m-0 flex items-center gap-2 font-serif text-[19px] font-normal tracking-[0.2px] text-[var(--color-ink-1)]">
        {{ title }}
        <span
          class="rounded-full bg-[var(--color-brand-soft)] px-[7px] py-0.5 font-mono text-[11px] font-medium text-[var(--color-brand-deep)]"
          >{{ count }}</span
        >
      </h3>
      <button
        class="grid h-7 w-7 place-items-center rounded-[9px] border-0 bg-[var(--color-input)] text-[var(--color-ink-2)] transition-all hover:-translate-y-px hover:bg-[var(--color-brand-soft)] hover:text-[var(--color-brand-deep)]"
        :aria-label="`新建${title}`"
        @click="emit('add')"
      >
        <AppIcon name="plus" :size="14" :stroke-width="2.4" />
      </button>
    </div>

    <div class="relative">
      <AppIcon
        name="search"
        :size="13"
        :stroke-width="2.2"
        class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-ink-3)]"
      />
      <input
        type="text"
        class="w-full rounded-xl border-0 bg-[var(--color-input)] py-[9px] pl-8 pr-3 text-[12.5px] text-[var(--color-ink-1)] transition-all placeholder:text-[var(--color-ink-3)] focus:bg-[#F7F8FA] focus:shadow-[0_0_0_4px_rgb(97_120_208/0.16)] focus:outline-none"
        :placeholder="searchPlaceholder"
        :value="modelValue"
        @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      />
    </div>

    <div class="scroll-thin flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pr-1">
      <slot />
    </div>

    <div v-if="$slots.footer" class="pt-1">
      <slot name="footer" />
    </div>
  </aside>
</template>
