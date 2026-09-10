<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ipc } from '@/composables/useIpc'
import { ui } from '@/stores/ui'

type AppSettings = Awaited<ReturnType<typeof ipc.settings.get>>
type AppInfo = Awaited<ReturnType<typeof ipc.app.info>>

const settings = ref<AppSettings | null>(null)
const info = ref<AppInfo | null>(null)
const saving = ref(false)

async function load(): Promise<void> {
  const [current, runtime] = await Promise.all([ipc.settings.get(), ipc.app.info()])
  settings.value = current
  info.value = runtime
}

async function save(): Promise<void> {
  if (!settings.value) return
  saving.value = true
  try {
    settings.value = await ipc.settings.set({ ...settings.value })
    ui.notify('设置已保存')
  } catch (err) {
    ui.notify(err instanceof Error ? err.message : '保存失败', 'error')
  } finally {
    saving.value = false
  }
}

async function reset(): Promise<void> {
  settings.value = await ipc.settings.reset()
  ui.notify('已恢复默认设置')
}

onMounted(load)
</script>

<template>
  <section class="flex h-full flex-col overflow-y-auto">
    <header class="border-b border-line bg-surface px-5 py-3">
      <h1 class="text-sm font-semibold">设置</h1>
      <p class="text-ink-soft text-xs">读写经 settings:* IPC 落到主进程 SettingsService</p>
    </header>

    <div v-if="settings" class="grid gap-5 p-5">
      <div class="rounded-2xl border border-line bg-surface p-5 shadow-panel">
        <h2 class="mb-4 text-sm font-semibold">偏好</h2>

        <label class="mb-4 grid gap-1.5">
          <span class="text-ink-soft text-xs">主题</span>
          <select
            v-model="settings.theme"
            class="rounded-lg border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand"
          >
            <option value="system">跟随系统</option>
            <option value="light">浅色</option>
            <option value="dark">深色</option>
          </select>
        </label>

        <label class="mb-4 grid gap-1.5">
          <span class="text-ink-soft text-xs">默认模型</span>
          <input
            v-model="settings.model"
            class="rounded-lg border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand"
          />
        </label>

        <label class="mb-4 grid gap-1.5">
          <span class="text-ink-soft text-xs">语言</span>
          <input
            v-model="settings.language"
            class="rounded-lg border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand"
          />
        </label>

        <label class="flex items-center gap-2 text-sm">
          <input v-model="settings.sendOnEnter" type="checkbox" class="accent-[var(--color-brand)]" />
          <span>Enter 直接发送（Shift + Enter 换行）</span>
        </label>
      </div>

      <div class="rounded-2xl border border-line bg-surface p-5 shadow-panel">
        <h2 class="mb-4 text-sm font-semibold">运行时</h2>
        <dl v-if="info" class="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <dt class="text-ink-soft">应用</dt>
          <dd>{{ info.name }} {{ info.version }}</dd>
          <dt class="text-ink-soft">Electron</dt>
          <dd>{{ info.electron }}</dd>
          <dt class="text-ink-soft">Node</dt>
          <dd>{{ info.node }}</dd>
          <dt class="text-ink-soft">Chromium</dt>
          <dd>{{ info.chrome }}</dd>
          <dt class="text-ink-soft">平台</dt>
          <dd>{{ info.platform }}</dd>
        </dl>
      </div>

      <div class="flex gap-2">
        <button
          class="bg-brand rounded-lg px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-50"
          :disabled="saving"
          @click="save"
        >
          {{ saving ? '保存中…' : '保存' }}
        </button>
        <button
          class="text-ink-soft hover:bg-surface-2 hover:text-ink rounded-lg border border-line px-4 py-2 text-sm transition-colors"
          @click="reset"
        >
          恢复默认
        </button>
      </div>
    </div>
  </section>
</template>
