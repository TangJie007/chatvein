<script setup lang="ts">
import { RouterLink } from 'vue-router'
import AppIcon from '../AppIcon.vue'

const nav = [
  { to: '/chat', label: '对话', icon: 'chat' },
  { to: '/agents', label: 'Agents', icon: 'robot' },
  { to: '/groups', label: '群组', icon: 'users' },
  { to: '/knowledge', label: '知识库', icon: 'database' },
  { to: '/mcp', label: 'MCP', icon: 'server' },
  { to: '/skills', label: 'Skills', icon: 'sparkles' },
]
</script>

<template>
  <nav
    class="flex flex-col gap-1 px-2.5 py-3.5"
    style="background: linear-gradient(180deg, rgb(248 249 251 / 0.92), rgb(233 236 240 / 0.9))"
    aria-label="模块导航"
  >
    <RouterLink
      v-for="item in nav"
      :key="item.to"
      :to="item.to"
      custom
      v-slot="{ isActive, navigate }"
    >
      <button
        type="button"
        class="rail-item group relative grid justify-items-center gap-[3px] rounded-[14px] border-0 bg-transparent px-0 py-[9px] pb-[7px] transition-colors duration-200"
        :class="
          isActive
            ? 'text-[var(--color-brand-deep)] shadow-[inset_0_0_0_1px_rgb(97_120_208/0.22)]'
            : 'text-[var(--color-ink-3)] hover:bg-[rgba(223,227,232,0.55)] hover:text-[var(--color-ink-2)]'
        "
        :style="
          isActive
            ? 'background: linear-gradient(180deg, var(--color-brand-mist), rgb(233 236 249 / 0.5))'
            : ''
        "
        :aria-label="item.label"
        @click="navigate"
      >
        <span
          v-if="isActive"
          class="absolute -left-2.5 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-[3px] bg-[var(--color-brand)]"
        />
        <AppIcon :name="item.icon" :size="19" />
        <span class="text-[10.5px] font-medium tracking-[0.2px]">{{ item.label }}</span>
      </button>
    </RouterLink>

    <div class="flex-1" />
    <div class="mx-1.5 my-2 h-px bg-[linear-gradient(90deg,transparent,rgba(165,177,193,0.4),transparent)]" />

    <RouterLink to="/settings" custom v-slot="{ isActive, navigate }">
      <button
        type="button"
        class="group relative grid justify-items-center gap-[3px] rounded-[14px] border-0 bg-transparent px-0 py-[9px] pb-[7px] transition-colors duration-200"
        :class="
          isActive
            ? 'text-[var(--color-brand-deep)] shadow-[inset_0_0_0_1px_rgb(97_120_208/0.22)]'
            : 'text-[var(--color-ink-3)] hover:bg-[rgba(223,227,232,0.55)] hover:text-[var(--color-ink-2)]'
        "
        :style="isActive ? 'background: linear-gradient(180deg, var(--color-brand-mist), rgb(233 236 249 / 0.5))' : ''"
        aria-label="设置"
        @click="navigate"
      >
        <span
          v-if="isActive"
          class="absolute -left-2.5 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-[3px] bg-[var(--color-brand)]"
        />
        <AppIcon name="gear" :size="19" />
        <span class="text-[10.5px] font-medium tracking-[0.2px]">设置</span>
      </button>
    </RouterLink>
  </nav>
</template>
