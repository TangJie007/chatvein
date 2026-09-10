<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ipc } from '@/composables/useIpc'

defineProps<{ module: string; item: string }>()

const maximized = ref(false)

async function toggleMaximize(): Promise<void> {
  maximized.value = await ipc.window.toggleMaximize()
}

onMounted(async () => {
  maximized.value = await ipc.window.isMaximized()
})
</script>

<template>
  <header class="drag-region flex items-center justify-between border-b border-line bg-surface pl-4">
    <div class="flex items-center gap-3">
      <div class="bg-brand flex h-6 w-6 items-center justify-center rounded-md text-[11px] font-bold text-white">
        CV
      </div>
      <span class="text-sm font-semibold">Chatvein</span>
      <span class="text-ink-soft text-xs">{{ module }} / {{ item }}</span>
    </div>

    <div class="no-drag flex h-full items-center">
      <button
        class="text-ink-soft hover:bg-surface-2 hover:text-ink flex h-full w-11 items-center justify-center text-xs transition-colors"
        title="最小化"
        @click="ipc.window.minimize()"
      >
        &#8211;
      </button>
      <button
        class="text-ink-soft hover:bg-surface-2 hover:text-ink flex h-full w-11 items-center justify-center text-xs transition-colors"
        :title="maximized ? '还原' : '最大化'"
        @click="toggleMaximize"
      >
        {{ maximized ? '&#10064;' : '&#9723;' }}
      </button>
      <button
        class="text-ink-soft flex h-full w-11 items-center justify-center text-xs transition-colors hover:bg-red-500 hover:text-white"
        title="关闭"
        @click="ipc.window.close()"
      >
        &#10005;
      </button>
    </div>
  </header>
</template>
