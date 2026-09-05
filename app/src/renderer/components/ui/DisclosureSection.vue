<script setup lang="ts">
/**
 * Headless UI Disclosure 外壳：可折叠区块（思考流 / 产物 / Trace 等复用）。
 */
import { Disclosure, DisclosureButton, DisclosurePanel } from '@headlessui/vue'
import AppIcon from '../AppIcon.vue'

withDefaults(
  defineProps<{
    title: string
    badge?: string
    defaultOpen?: boolean
    rootClass?: string
    panelClass?: string
  }>(),
  {
    badge: '',
    defaultOpen: false,
    rootClass: '',
    panelClass: '',
  },
)
</script>

<template>
  <Disclosure
    v-slot="{ open }"
    as="section"
    :default-open="defaultOpen"
    class="flex min-h-0 flex-col rounded-[12px] bg-[var(--color-track)] shadow-[inset_0_0_0_1px_rgba(223,227,232,0.7)]"
    :class="rootClass"
  >
    <DisclosureButton
      class="flex w-full items-center gap-1.5 rounded-[12px] border-0 bg-transparent px-2.5 py-2 text-left transition-colors hover:bg-[var(--color-hover)] focus-visible:outline-2 focus-visible:outline-[var(--color-brand)] focus-visible:outline-offset-[-2px]"
    >
      <AppIcon
        name="chevron"
        :size="11"
        :stroke-width="2.6"
        class="shrink-0 text-[var(--color-ink-3)] transition-transform duration-200"
        :class="open ? 'rotate-90' : ''"
      />
      <span class="text-[12.5px] font-semibold text-[var(--color-ink-1)]">{{ title }}</span>
      <span v-if="badge" class="ml-auto font-mono text-[10px] text-[var(--color-ink-3)]">{{ badge }}</span>
      <slot name="badge" :open="open" />
    </DisclosureButton>

    <DisclosurePanel
      class="flex min-h-0 flex-col gap-1.5 overflow-y-auto px-2.5 pb-2.5"
      :class="panelClass"
    >
      <slot :open="open" />
    </DisclosurePanel>
  </Disclosure>
</template>
