<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue'
import { NAV_ITEMS } from '@/router'
</script>

<template>
  <nav class="flex flex-col items-center gap-2 border-r border-line bg-surface py-4">
    <RouterLink
      v-for="item in NAV_ITEMS"
      :key="item.path"
      :to="item.path"
      class="text-ink-soft hover:bg-surface-2 flex h-14 w-14 flex-col items-center justify-center gap-1 rounded-xl text-[11px] transition-colors"
      active-class="bg-brand-soft text-brand"
    >
      <AppIcon :path="item.icon" :size="20" />
      <span>{{ item.label }}</span>
    </RouterLink>
  </nav>
</template>
