<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { createClient } from '@electrum/client'
import type { IpcApi } from './ipc-api'
import TitleBar from './components/layout/TitleBar.vue'
import NavRail from './components/layout/NavRail.vue'
import { ui } from './composables/useUi'

const route = useRoute()
const router = useRouter()
const api = createClient<IpcApi>()
const crumbModule = computed(() => (route.meta.module as string) ?? '对话')

let offNavigate: (() => void) | undefined
onMounted(() => {
  // Native app-menu navigation → vue-router (hash route paths)
  offNavigate = api.on('menu:navigate', (path: unknown) => {
    if (typeof path === 'string' && path.startsWith('/')) void router.push(path)
  })
})
onUnmounted(() => offNavigate?.())
</script>

<template>
  <div
    class="relative grid h-screen w-screen overflow-hidden rounded-[22px] bg-[var(--color-canvas)] shadow-[var(--shadow-3)]"
    style="grid-template-rows: 52px 1fr; isolation: isolate"
  >
    <TitleBar :crumb-module="crumbModule" :crumb-item="ui.crumbItem || '工作台'" />

    <div class="grid min-h-0" style="grid-template-columns: 78px 300px 1fr">
      <NavRail />
      <RouterView v-slot="{ Component }">
        <component :is="Component" />
      </RouterView>
    </div>
  </div>
</template>
