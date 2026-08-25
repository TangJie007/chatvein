<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  Monitor,
  User,
  Document,
  Setting,
} from '@element-plus/icons-vue'
import { createClient } from '@electrum/client'
import type { IpcApi, NavView } from './ipc-api'
import TitleBar from './components/TitleBar.vue'
import DashboardView from './views/DashboardView.vue'
import UsersView from './views/UsersView.vue'
import FilesView from './views/FilesView.vue'
import WindowsView from './views/WindowsView.vue'

const api = createClient<IpcApi>()

const params = new URLSearchParams(window.location.search)
const isChild = params.get('view') === 'child'
const childTitle = params.get('title') || '子窗口'

const active = ref<NavView>((params.get('nav') as NavView) || 'dashboard')
const appTitle = ref(isChild ? childTitle : 'Electrum Admin')

const menuItems = [
  { key: 'dashboard' as const, label: '工作台', icon: Monitor },
  { key: 'users' as const, label: '用户管理', icon: User },
  { key: 'files' as const, label: '文件读写', icon: Document },
  { key: 'windows' as const, label: '窗口与菜单', icon: Setting },
]

const pageTitle = computed(() => {
  if (isChild) return childTitle
  return menuItems.find((m) => m.key === active.value)?.label || 'Electrum Admin'
})

let offNavigate: (() => void) | undefined

onMounted(() => {
  void api.app.info().then((info) => {
    if (!isChild) {
      appTitle.value = `${info.name}`
      document.title = `${info.name} v${info.version}`
    } else {
      document.title = childTitle
    }
  })

  offNavigate = api.on('menu:navigate', (view) => {
    if (typeof view === 'string' && menuItems.some((m) => m.key === view)) {
      active.value = view as NavView
    }
  })
})

onUnmounted(() => {
  offNavigate?.()
})
async function openAnotherChild() {
  await api.window.openChild({ title: '又一个子窗口' })
}
</script>

<template>
  <div class="app-shell">
    <TitleBar v-model="active" :title="pageTitle" :is-child="isChild" />

    <div v-if="isChild" class="child-body">
      <el-result icon="success" title="这是一个子窗口" :sub-title="childTitle">
        <template #extra>
          <p class="hint">
            与主窗口共享同一套 preload / Renderer。可用标题栏自定义缩小、最大化与关闭；也可用
            Ctrl+N 再开更多窗口。
          </p>
          <el-button type="primary" @click="openAnotherChild">
            再开一个子窗口
          </el-button>
        </template>
      </el-result>
    </div>

    <el-container v-else class="main-body">
      <el-aside width="220px" class="aside">
        <div class="brand-block">
          <div class="brand-name">{{ appTitle }}</div>
          <div class="brand-sub">示例管理端</div>
        </div>
        <el-menu :default-active="active" class="side-menu" @select="(k: string) => (active = k as NavView)">
          <el-menu-item v-for="item in menuItems" :key="item.key" :index="item.key">
            <el-icon><component :is="item.icon" /></el-icon>
            <span>{{ item.label }}</span>
          </el-menu-item>
        </el-menu>
      </el-aside>

      <el-main class="content">
        <DashboardView v-if="active === 'dashboard'" />
        <UsersView v-else-if="active === 'users'" />
        <FilesView v-else-if="active === 'files'" />
        <WindowsView v-else-if="active === 'windows'" />
      </el-main>
    </el-container>
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  background: #f5f7fa;
}

.main-body {
  flex: 1;
  min-height: 0;
}

.aside {
  border-right: 1px solid #e4e7ed;
  background: #fff;
  display: flex;
  flex-direction: column;
}

.brand-block {
  padding: 18px 18px 12px;
}

.brand-name {
  font-size: 15px;
  font-weight: 700;
  color: #303133;
}

.brand-sub {
  margin-top: 4px;
  font-size: 12px;
  color: #909399;
}

.side-menu {
  border-right: none;
  background: transparent;
  flex: 1;
}

.content {
  padding: 20px 22px;
  overflow: auto;
  background: #f5f7fa;
}

.child-body {
  flex: 1;
  display: grid;
  place-items: center;
  padding: 24px;
  background: #f5f7fa;
}

.hint {
  max-width: 420px;
  margin: 0 auto 16px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.5;
}
</style>
