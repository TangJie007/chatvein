<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { createClient } from '@electrum/client'
import type { IpcApi } from '../ipc-api'

const api = createClient<IpcApi>()

const windows = ref<Array<{ id: number; title: string; focused: boolean }>>([])
const childTitle = ref('业务子窗口')
const loading = ref(false)
let timer: ReturnType<typeof setInterval> | undefined

async function refresh() {
  loading.value = true
  try {
    windows.value = await api.window.list()
  } catch (err: any) {
    ElMessage.error(String(err))
  } finally {
    loading.value = false
  }
}

async function openChild() {
  const win = await api.window.openChild({ title: childTitle.value || '子窗口' })
  ElMessage.success(`已创建窗口 #${win.id}`)
  await refresh()
}

async function focusWin(id: number) {
  const ok = await api.window.focus(id)
  if (!ok) ElMessage.warning('窗口不存在')
  await refresh()
}

async function reloadMenu() {
  await api.window.reloadMenu()
  ElMessage.success('原生应用菜单已重新应用（快捷键 Cmd/Ctrl+1~4 可导航）')
}

onMounted(() => {
  void refresh()
  timer = setInterval(() => void refresh(), 2500)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h2>窗口与菜单</h2>
        <p>演示多窗口、窗口控制 API，以及自定义原生菜单 / 标题栏菜单。</p>
      </div>
      <el-button @click="refresh">刷新列表</el-button>
    </div>

    <el-row :gutter="16">
      <el-col :span="12">
        <el-card shadow="never" v-loading="loading">
          <template #header>当前窗口</template>
          <el-table :data="windows" size="small" empty-text="无窗口">
            <el-table-column prop="id" label="ID" width="70" />
            <el-table-column prop="title" label="标题" min-width="140" />
            <el-table-column label="状态" width="90">
              <template #default="{ row }">
                <el-tag v-if="row.focused" size="small" type="success">聚焦</el-tag>
                <el-tag v-else size="small" type="info">后台</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="90">
              <template #default="{ row }">
                <el-button link type="primary" @click="focusWin(row.id)">聚焦</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>

      <el-col :span="12">
        <el-card shadow="never">
          <template #header>打开子窗口</template>
          <el-form label-position="top">
            <el-form-item label="窗口标题">
              <el-input v-model="childTitle" placeholder="子窗口标题" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="openChild">新建子窗口</el-button>
              <el-button @click="reloadMenu">重载原生菜单</el-button>
            </el-form-item>
          </el-form>
          <el-alert
            type="info"
            :closable="false"
            show-icon
            title="提示"
            description="无边框窗口在 Windows 上不会显示系统菜单栏；标题栏「文件 / 导航 / 窗口」是应用内自定义菜单。原生 Menu 仍注册快捷键（Ctrl+N、Ctrl+1~4 等）。"
          />
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<style scoped>
.page-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.page-head h2 {
  margin: 0 0 6px;
  font-size: 20px;
  font-weight: 650;
}

.page-head p {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
</style>
