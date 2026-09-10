<script setup lang="ts">
import { ui } from '@/stores/ui'
</script>

<template>
  <div class="pointer-events-none fixed right-4 top-14 z-50 flex w-72 flex-col gap-2">
    <button
      v-for="notice in ui.notices"
      :key="notice.id"
      class="pointer-events-auto rounded-lg px-3 py-2 text-left text-sm text-white shadow-panel"
      :class="notice.tone === 'error' ? 'bg-red-500' : 'bg-ink'"
      @click="ui.dismiss(notice.id)"
    >
      {{ notice.text }}
    </button>
  </div>
</template>
