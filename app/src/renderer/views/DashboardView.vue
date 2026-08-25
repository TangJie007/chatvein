<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { createClient } from '@electrum/client'
import type { IpcApi } from '../ipc-api'

const api = createClient<IpcApi>()

const info = ref<Record<string, string> | null>(null)
const pingText = ref('')
const loading = ref(true)

onMounted(async () => {
  try {
    const data = await api.app.info()
    info.value = {
      应用: data.name,
      版本: data.version,
      Electron: data.electron,
      Chrome: data.chrome,
      Node: data.node,
      平台: data.platform,
    }
    document.title = `${data.name} v${data.version}`
  } catch (err) {
    info.value = { 错误: String(err) }
  } finally {
    loading.value = false
  }
})

async function onPing() {
  const res = await api.app.ping('hello-electrum')
  pingText.value = JSON.stringify(res)
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h2>工作台</h2>
      <p>通过 IPC 读取主进程应用信息，验证 Client / Preload / Controller 链路。</p>
    </div>

    <el-row :gutter="16">
      <el-col :span="14">
        <el-card shadow="never" v-loading="loading">
          <template #header>
            <div class="card-head">
              <span>应用信息 · app:info</span>
              <el-button type="primary" size="small" @click="onPing">Ping 主进程</el-button>
            </div>
          </template>
          <el-descriptions v-if="info" :column="1" border size="small">
            <el-descriptions-item v-for="(val, key) in info" :key="key" :label="String(key)">
              <code>{{ val }}</code>
            </el-descriptions-item>
          </el-descriptions>
          <p v-if="pingText" class="ping">{{ pingText }}</p>
        </el-card>
      </el-col>
      <el-col :span="10">
        <el-card shadow="never">
          <template #header>能力一览</template>
          <el-timeline>
            <el-timeline-item timestamp="窗口" placement="top" type="primary">
              无边框自定义标题栏：缩小 / 最大化 / 关闭
            </el-timeline-item>
            <el-timeline-item timestamp="菜单" placement="top" type="success">
              标题栏自定义菜单 + 原生 Menu（快捷键）
            </el-timeline-item>
            <el-timeline-item timestamp="多窗口" placement="top" type="warning">
              打开独立子窗口，可在「窗口与菜单」里管理
            </el-timeline-item>
            <el-timeline-item timestamp="业务" placement="top" type="info">
              用户 CRUD、本地文件读写与推送
            </el-timeline-item>
          </el-timeline>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<style scoped>
.page-head {
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

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.ping {
  margin: 12px 0 0;
  font-family: Consolas, monospace;
  font-size: 12px;
  color: var(--el-color-success);
}

code {
  font-family: Consolas, 'Cascadia Code', monospace;
  font-size: 12px;
}
</style>
