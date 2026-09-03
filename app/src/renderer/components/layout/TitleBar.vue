<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { createClient } from '@electrum/client'
import type { IpcApi } from '../../ipc-api'
import AppIcon from '../AppIcon.vue'

defineProps<{ crumbModule: string; crumbItem: string }>()

const api = createClient<IpcApi>()
const maximized = ref(false)

async function refresh() {
  try {
    maximized.value = await api.window.isMaximized()
  } catch {
    maximized.value = false
  }
}

onMounted(() => {
  void refresh()
  window.addEventListener('resize', refresh)
})
onUnmounted(() => window.removeEventListener('resize', refresh))

function win(action: 'min' | 'max' | 'close') {
  if (action === 'min') void api.window.minimize()
  else if (action === 'max') void api.window.toggleMaximize().then((v) => (maximized.value = v))
  else void api.window.close()
}
</script>

<template>
  <header
    class="app-drag relative z-[6] grid grid-cols-[auto_auto_1fr_auto] items-center gap-4 px-4"
    style="
      height: 52px;
      background: linear-gradient(180deg, rgb(254 254 254 / 0.96), rgb(245 246 248 / 0.88));
      backdrop-filter: blur(40px) saturate(180%);
      -webkit-backdrop-filter: blur(40px) saturate(180%);
    "
  >
    <!-- macOS-style traffic lights (also work on win via IPC) -->
    <div class="app-no-drag flex items-center gap-[9px] [&:hover_.glyph]:opacity-100">
      <button
        class="win-btn group grid h-[13px] w-[13px] place-items-center rounded-full border-0 p-0 transition-transform duration-200 hover:scale-[1.18]"
        style="background: var(--color-danger); box-shadow: inset 0 0 0 1px rgb(168 43 60 / 0.3)"
        aria-label="关闭"
        @click="win('close')"
      >
        <AppIcon name="x" :size="9" :stroke-width="2.6" class="glyph opacity-0 transition-opacity" />
      </button>
      <button
        class="win-btn grid h-[13px] w-[13px] place-items-center rounded-full border-0 p-0 transition-transform duration-200 hover:scale-[1.18]"
        style="background: var(--color-warn); box-shadow: inset 0 0 0 1px rgb(138 100 20 / 0.3)"
        aria-label="最小化"
        @click="win('min')"
      >
        <span class="glyph h-0 w-[9px] border-t-[1.6px] border-[#6B4A0A] opacity-0 transition-opacity" />
      </button>
      <button
        class="win-btn grid h-[13px] w-[13px] place-items-center rounded-full border-0 p-0 transition-transform duration-200 hover:scale-[1.18]"
        style="background: var(--color-ok); box-shadow: inset 0 0 0 1px rgb(63 122 99 / 0.3)"
        aria-label="最大化"
        @click="win('max')"
      >
        <span class="glyph h-[8px] w-[8px] rounded-[2px] border-[1.6px] border-[#1F5A42] opacity-0 transition-opacity" />
      </button>
    </div>

    <!-- Brand -->
    <div class="flex items-center gap-2.5">
      <div
        class="grid h-[26px] w-[26px] place-items-center rounded-lg font-serif text-lg text-white"
        style="
          background: linear-gradient(140deg, var(--color-brand-lite), var(--color-brand-deep));
          box-shadow: 0 4px 12px rgb(90 111 203 / 0.34), inset 0 1px 0 rgb(255 255 255 / 0.35);
          transform: rotate(-3deg);
        "
      >
        F
      </div>
      <div class="font-serif text-[17px] tracking-[0.2px] text-[var(--color-ink-1)]">
        Forge<em class="italic" style="color: var(--color-brand-deep)">·chatvein</em>
      </div>
    </div>

    <!-- Crumb -->
    <div class="flex items-center gap-2 pl-1 text-xs font-medium text-[var(--color-ink-3)]">
      <span class="text-[rgba(165,177,193,0.7)]">/</span>
      <b class="font-semibold text-[var(--color-ink-2)]">{{ crumbModule }}</b>
      <span class="text-[rgba(165,177,193,0.7)]">/</span>
      <span class="truncate">{{ crumbItem }}</span>
    </div>

    <!-- Actions -->
    <div class="app-no-drag flex items-center gap-1.5">
      <button
        class="grid h-8 w-8 place-items-center rounded-[10px] border-0 bg-transparent text-[var(--color-ink-2)] transition-colors hover:bg-[var(--color-hover)] hover:text-[var(--color-ink-1)]"
        aria-label="搜索"
      >
        <AppIcon name="search" :size="16" :stroke-width="2" />
      </button>
      <button
        class="grid h-8 w-8 place-items-center rounded-[10px] border-0 bg-transparent text-[var(--color-ink-2)] transition-colors hover:bg-[var(--color-hover)] hover:text-[var(--color-ink-1)]"
        aria-label="运行队列"
      >
        <AppIcon name="activity" :size="16" :stroke-width="2" />
      </button>
      <button
        class="grid h-8 w-8 place-items-center rounded-[10px] border-0 text-white shadow-[var(--shadow-brand)] transition-transform hover:-translate-y-px"
        style="background: linear-gradient(180deg, var(--color-brand-lite), var(--color-brand-solid))"
        aria-label="新建"
      >
        <AppIcon name="plus" :size="16" :stroke-width="2.4" />
      </button>
    </div>
  </header>
</template>
