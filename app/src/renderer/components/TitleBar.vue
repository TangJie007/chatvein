<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  Minus,
  FullScreen,
  CopyDocument,
  Close,
  Monitor,
  User,
  Document,
  Setting,
  ArrowDown,
} from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { createClient } from '@electrum/client'
import type { IpcApi, NavView } from '../ipc-api'

const props = defineProps<{
  modelValue: NavView
  title: string
  isChild?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [NavView]
}>()

const api = createClient<IpcApi>()
const maximized = ref(false)

const active = computed({
  get: () => props.modelValue,
  set: (v: NavView) => emit('update:modelValue', v),
})

async function refreshMaximized() {
  try {
    maximized.value = await api.window.isMaximized()
  } catch {
    maximized.value = false
  }
}

async function minimize() {
  await api.window.minimize()
}

async function toggleMaximize() {
  maximized.value = await api.window.toggleMaximize()
}

async function closeWin() {
  await api.window.close()
}

async function openChild() {
  const win = await api.window.openChild({ title: `子窗口 ${new Date().toLocaleTimeString()}` })
  ElMessage.success(`已打开：${win.title}`)
}

function onMenu(command: string) {
  switch (command) {
    case 'new-window':
      void openChild()
      break
    case 'dashboard':
    case 'users':
    case 'files':
    case 'windows':
      active.value = command
      break
    case 'reload-menu':
      void api.window.reloadMenu().then(() => ElMessage.success('已重新应用原生菜单'))
      break
    case 'devtools':
      ElMessage.info('可用快捷键 Ctrl+Shift+I，或原生菜单「帮助 → 切换开发者工具」')
      break
    case 'minimize':
      void minimize()
      break
    case 'maximize':
      void toggleMaximize()
      break
    case 'close':
      void closeWin()
      break
  }
}

function onResize() {
  void refreshMaximized()
}

onMounted(() => {
  void refreshMaximized()
  window.addEventListener('resize', onResize)
})

onUnmounted(() => {
  window.removeEventListener('resize', onResize)
})
</script>

<template>
  <header class="titlebar">
    <div class="titlebar-left">
      <span class="logo">Electrum</span>
      <el-dropdown trigger="click" @command="onMenu">
        <button type="button" class="menu-btn">
          文件
          <el-icon class="el-icon--right"><ArrowDown /></el-icon>
        </button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="new-window">新建子窗口</el-dropdown-item>
            <el-dropdown-item divided command="reload-menu">重载原生菜单</el-dropdown-item>
            <el-dropdown-item divided command="close">关闭窗口</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>

      <el-dropdown v-if="!isChild" trigger="click" @command="onMenu">
        <button type="button" class="menu-btn">
          导航
          <el-icon class="el-icon--right"><ArrowDown /></el-icon>
        </button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="dashboard">
              <el-icon><Monitor /></el-icon>工作台
            </el-dropdown-item>
            <el-dropdown-item command="users">
              <el-icon><User /></el-icon>用户管理
            </el-dropdown-item>
            <el-dropdown-item command="files">
              <el-icon><Document /></el-icon>文件读写
            </el-dropdown-item>
            <el-dropdown-item command="windows">
              <el-icon><Setting /></el-icon>窗口与菜单
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>

      <el-dropdown trigger="click" @command="onMenu">
        <button type="button" class="menu-btn">
          窗口
          <el-icon class="el-icon--right"><ArrowDown /></el-icon>
        </button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="minimize">最小化</el-dropdown-item>
            <el-dropdown-item command="maximize">最大化 / 还原</el-dropdown-item>
            <el-dropdown-item command="devtools">开发者工具提示</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

    <div class="titlebar-title">{{ title }}</div>

    <div class="titlebar-controls">
      <button type="button" class="win-btn" title="最小化" @click="minimize">
        <el-icon :size="14"><Minus /></el-icon>
      </button>
      <button
        type="button"
        class="win-btn"
        :title="maximized ? '还原' : '最大化'"
        @click="toggleMaximize"
      >
        <el-icon :size="13">
          <CopyDocument v-if="maximized" />
          <FullScreen v-else />
        </el-icon>
      </button>
      <button type="button" class="win-btn win-btn-close" title="关闭" @click="closeWin">
        <el-icon :size="14"><Close /></el-icon>
      </button>
    </div>
  </header>
</template>

<style scoped>
.titlebar {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  height: 40px;
  padding: 0 0 0 12px;
  background: #fff;
  border-bottom: 1px solid #e4e7ed;
  -webkit-app-region: drag;
  user-select: none;
}

.titlebar-left {
  display: flex;
  align-items: center;
  gap: 4px;
  -webkit-app-region: no-drag;
}

.logo {
  margin-right: 8px;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: #409eff;
}

.menu-btn {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 28px;
  padding: 0 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #606266;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.menu-btn:hover {
  background: #f2f3f5;
  color: #303133;
}

.titlebar-title {
  font-size: 12px;
  color: #909399;
  pointer-events: none;
}

.titlebar-controls {
  display: flex;
  justify-content: flex-end;
  height: 100%;
  -webkit-app-region: no-drag;
}

.win-btn {
  width: 46px;
  height: 100%;
  border: 0;
  background: transparent;
  color: #606266;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.win-btn:hover {
  background: #f2f3f5;
  color: #303133;
}

.win-btn-close:hover {
  background: #e81123;
  color: #fff;
}
</style>
