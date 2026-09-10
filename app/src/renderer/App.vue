<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import NavRail from '@/components/NavRail.vue'
import NoticeStack from '@/components/NoticeStack.vue'
import TitleBar from '@/components/TitleBar.vue'
import { ipc } from '@/composables/useIpc'
import { ui } from '@/stores/ui'

const route = useRoute()

const crumbModule = computed(() => (route.meta.module as string) ?? '对话')
const crumbItem = computed(() => ui.crumbItem)

onMounted(async () => {
  // 启动即打一次 IPC 往返，确认 preload → 主进程链路可用
  try {
    const res = await ipc.app.ping('Chatvein')
    ui.crumbItem = res.echo
  } catch (err) {
    ui.notify(err instanceof Error ? err.message : 'IPC 连接失败', 'error')
  }
})
</script>

<template>
  <div
    class="grid h-screen w-screen overflow-hidden bg-canvas text-ink"
    style="grid-template-rows: 48px 1fr"
  >
    <TitleBar :module="crumbModule" :item="crumbItem" />

    <div class="grid min-h-0" style="grid-template-columns: 72px 1fr">
      <NavRail />
      <main class="min-h-0 overflow-hidden">
        <RouterView />
      </main>
    </div>

    <NoticeStack />
  </div>
</template>
