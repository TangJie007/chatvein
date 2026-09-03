<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    name: string
    size?: number
    strokeWidth?: number
  }>(),
  { size: 18, strokeWidth: 1.8 },
)

// Each entry is the inner markup of a 24x24 stroke icon (stroke=currentColor).
const paths: Record<string, string> = {
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  activity:
    '<path d="M3 12h4l3 8 4-16 3 8h4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chat: '<path d="M21 14a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z"/>',
  robot:
    '<rect x="4" y="8" width="16" height="12" rx="3.5"/><path d="M12 3v5"/><circle cx="9.2" cy="14" r="1.1" fill="currentColor" stroke="none"/><circle cx="14.8" cy="14" r="1.1" fill="currentColor" stroke="none"/><path d="M2.5 13v2.5M21.5 13v2.5"/>',
  users:
    '<path d="M15.5 20.5v-1.8a3.5 3.5 0 0 0-3.5-3.5H6.2a3.5 3.5 0 0 0-3.5 3.5v1.8"/><circle cx="9.1" cy="7.5" r="3.5"/><path d="M21.3 20.5v-1.8a3.5 3.5 0 0 0-2.6-3.4"/><path d="M16.2 4.2a3.5 3.5 0 0 1 0 6.6"/>',
  database:
    '<ellipse cx="12" cy="5.5" rx="7.5" ry="3"/><path d="M4.5 5.5v13c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3v-13"/><path d="M4.5 12c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3"/>',
  server:
    '<rect x="2.5" y="4" width="19" height="7" rx="2.2"/><rect x="2.5" y="13" width="19" height="7" rx="2.2"/><path d="M6.5 7.5h.01M6.5 16.5h.01"/><path d="M10.5 7.5h4M10.5 16.5h4"/>',
  sparkles:
    '<path d="M15 4V2.5M15 16.5V15M8.5 9.5h1.5M20 9.5h1.5M17.8 11.8l1.2 1.2M15 9.5h.01M17.8 6.2L19 5M3.5 20.5l8.5-8.5M12.2 6.2L11 5"/>',
  gear:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  send: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  paperclip:
    '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.5 8.5 0 1 1-8.4-12.6 8.4 8.4 0 0 1 8.4 8.4v3a3 3 0 1 1-6 0V9"/>',
  image:
    '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
  wrench:
    '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.7-3.7a6 6 0 0 1-7.9 7.9L8.7 18.7a4 4 0 0 1-5.6-5.6l8-8a2.8 2.8 0 1 1 4 4l-7 7a1.5 1.5 0 1 1-2.2-2L9.6 9"/>',
  mic:
    '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v4M8 23h8"/>',
  at: '<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.9 7.9"/>',
  'check-square':
    '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  pin: '<path d="M12 2a8 8 0 0 0-8 8c0 6 8 12 8 12s8-6 8-12a8 8 0 0 0-8-8z"/><circle cx="12" cy="10" r="3"/>',
  sun: '<path d="M12 2v4M12 18v4M4.9 4.9l2.9 2.9M16.2 16.2l2.9 2.9M2 12h4M18 12h4M4.9 19.1l2.9-2.9M16.2 7.8l2.9-2.9"/>',
  shield:
    '<path d="M12 22s8-4 8-10V5.5l-8-3-8 3V12c0 6 8 10 8 10z"/>',
  bulb:
    '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.4.3.6.8.6 1.3v.8h5.8v-.8c0-.5.2-1 .6-1.3A6 6 0 0 0 12 3z"/>',
  chart:
    '<path d="M3 3v18h18"/><path d="M7 16l4-6 4 3 5-8"/>',
  history:
    '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  alert:
    '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.86l-7.6 13.18A2 2 0 0 0 4.43 20h15.14a2 2 0 0 0 1.73-2.96L13.7 3.86a2 2 0 0 0-3.4 0z"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  restart:
    '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  download:
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
  folder:
    '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
}

const inner = computed(() => paths[props.name] ?? paths.chat)
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="strokeWidth"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    v-html="inner"
  />
</template>
