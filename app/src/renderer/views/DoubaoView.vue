<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { createClient } from '@electrum/client'
import type { IpcApi, DoubaoDiagnostic } from '../ipc-api'

const api = createClient<IpcApi>()

const status = ref<'idle' | 'connecting' | 'ready' | 'generating' | 'error'>('idle')
const hasWebview = ref(false)
const loading = ref(false)
const lastError = ref('')
const prompt = ref('')
const messages = ref<Array<{ role: string; content: string; timestamp: number }>>([])
const xmlOutput = ref('')
const copyXml = ref('')
const diagResult = ref<DoubaoDiagnostic | null>(null)

const preloadPath = ref('')
const showWebview = ref(false)
const webviewSrc = ref('about:blank')

const isGenerating = computed(() => status.value === 'generating')

onMounted(async () => {
  try {
    const { status: s, hasWebview: hw } = await api.doubao.status()
    status.value = s
    hasWebview.value = hw
  } catch { /* ignore */ }
})

async function onConnect() {
  loading.value = true
  lastError.value = ''
  try {
    const result = await api.doubao.connect()
    preloadPath.value = result.preloadPath
    status.value = result.status
    // 触发 webview 渲染
    showWebview.value = true
    webviewSrc.value = 'https://www.doubao.com/chat/'
    ElMessage.success('豆包 webview 已嵌入，请在页面中登录')
  } catch (err: any) {
    lastError.value = err.message || String(err)
    ElMessage.error(`连接失败: ${lastError.value}`)
  } finally {
    loading.value = false
  }
}

async function onDisconnect() {
  try {
    await api.doubao.disconnect()
    status.value = 'idle'
    hasWebview.value = false
    showWebview.value = false
    webviewSrc.value = 'about:blank'
    lastError.value = ''
    diagResult.value = null
  } catch { /* ignore */ }
}

async function onDiagnose() {
  try {
    const diag = await api.doubao.diagnose()
    diagResult.value = diag
    ElMessage.info(`页面状态: ${diag.pageHint}`)
  } catch (err: any) {
    ElMessage.error(`诊断失败: ${err.message || err}`)
  }
}

async function onSend() {
  if (!prompt.value.trim()) {
    ElMessage.warning('请输入 prompt')
    return
  }
  if (status.value === 'idle' || status.value === 'error') {
    ElMessage.warning('请先连接豆包')
    return
  }

  loading.value = true
  lastError.value = ''
  try {
    const result = await api.doubao.send({ prompt: prompt.value, waitForCompletion: true })
    if (!result.ok) {
      lastError.value = result.error || '发送失败'
      ElMessage.error(lastError.value)
      return
    }
    if (result.messages) {
      messages.value = result.messages
    }
    if (result.xml) {
      xmlOutput.value = result.xml
      copyXml.value = result.xml
    }
    ElMessage.success('响应完成')
  } catch (err: any) {
    lastError.value = err.message || String(err)
    ElMessage.error(`发送失败: ${lastError.value}`)
    status.value = 'error'
  } finally {
    loading.value = false
  }
}

async function onExtract() {
  try {
    const xml = await api.doubao.extract()
    xmlOutput.value = xml
    copyXml.value = xml
    ElMessage.success('提取成功')
  } catch (err: any) {
    ElMessage.error(`提取失败: ${err.message || err}`)
  }
}

async function onGetMessages() {
  try {
    const msgs = await api.doubao.messages()
    messages.value = msgs
  } catch (err: any) {
    ElMessage.error(String(err))
  }
}

async function onCopyXml() {
  try {
    await navigator.clipboard.writeText(copyXml.value)
    ElMessage.success('已复制到剪贴板')
  } catch (err: any) {
    ElMessage.error(`复制失败: ${err.message || err}`)
  }
}

function statusTagType() {
  switch (status.value) {
    case 'ready': return 'success'
    case 'connecting': return 'warning'
    case 'generating': return 'info'
    case 'error': return 'danger'
    default: return 'info'
  }
}

function statusText() {
  switch (status.value) {
    case 'idle': return '未连接'
    case 'connecting': return '连接中...'
    case 'ready': return '就绪'
    case 'generating': return '生成中...'
    case 'error': return '错误'
  }
}
</script>

<template>
  <div class="doubao-view">
    <div class="view-header">
      <h2>豆包 LLM 实验</h2>
      <el-tag :type="statusTagType()" size="small">{{ statusText() }}</el-tag>
    </div>

    <div class="layout">
      <!-- 左侧控制面板 -->
      <div class="control-panel">
        <el-card class="control-card">
          <template #header>
            <span>控制面板</span>
          </template>

          <div class="control-row">
            <el-button
              type="primary"
              :disabled="hasWebview"
              :loading="loading && status === 'connecting'"
              @click="onConnect"
            >
              {{ hasWebview ? '已连接' : '连接豆包' }}
            </el-button>
            <el-button
              :disabled="!hasWebview"
              @click="onDisconnect"
            >
              断开
            </el-button>
            <el-button
              :disabled="!hasWebview"
              @click="onDiagnose"
              type="warning"
            >
              诊断
            </el-button>
          </div>

          <!-- 诊断结果 -->
          <div class="diag-box" v-if="diagResult">
            <el-descriptions :column="1" size="small" border>
              <el-descriptions-item label="页面状态">
                <el-tag :type="diagResult.pageHint.includes('已加载') ? 'success' : 'warning'">
                  {{ diagResult.pageHint }}
                </el-tag>
              </el-descriptions-item>
              <el-descriptions-item label="URL">
                <code>{{ diagResult.url }}</code>
              </el-descriptions-item>
              <el-descriptions-item label="标题">
                {{ diagResult.title || '(空)' }}
              </el-descriptions-item>
              <el-descriptions-item label="输入框">
                textarea: {{ diagResult.hasTextarea ? '✅' : '❌' }} |
                contenteditable: {{ diagResult.hasContentEditable ? '✅' : '❌' }}
              </el-descriptions-item>
              <el-descriptions-item label="页面预览">
                <pre class="diag-body">{{ diagResult.bodyText || '(无内容)' }}</pre>
              </el-descriptions-item>
            </el-descriptions>
          </div>

          <el-divider />

          <div class="control-section">
            <el-input
              v-model="prompt"
              type="textarea"
              :rows="4"
              placeholder="输入 prompt..."
              :disabled="isGenerating"
            />
            <div class="control-row" style="margin-top: 8px">
              <el-button
                type="primary"
                :disabled="!hasWebview || isGenerating || !prompt.trim()"
                :loading="loading && isGenerating"
                @click="onSend"
              >
                发送
              </el-button>
              <el-button
                :disabled="!hasWebview"
                @click="onGetMessages"
              >
                刷新消息
              </el-button>
              <el-button
                :disabled="!hasWebview"
                @click="onExtract"
              >
                提取 XML
              </el-button>
            </div>
          </div>

          <div class="error-box" v-if="lastError">
            <el-alert :title="lastError" type="error" :closable="false" show-icon />
          </div>
        </el-card>

        <!-- XML 输出 -->
        <el-card class="xml-card">
          <template #header>
            <div class="card-header">
              <span>XML 输出</span>
              <el-button
                size="small"
                type="primary"
                :disabled="!copyXml"
                @click="onCopyXml"
              >
                复制
              </el-button>
            </div>
          </template>
          <pre class="xml-output">{{ xmlOutput || '// 尚未提取消息' }}</pre>
        </el-card>

        <!-- 对话记录 -->
        <el-card class="messages-card">
          <template #header>
            <span>对话记录 ({{ messages.length }})</span>
          </template>
          <div class="message-list" v-if="messages.length > 0">
            <div
              v-for="(msg, idx) in messages"
              :key="idx"
              class="message-item"
              :class="msg.role"
            >
              <el-tag :type="msg.role === 'user' ? 'primary' : 'success'" size="small">
                {{ msg.role }}
              </el-tag>
              <span class="msg-content">{{ msg.content }}</span>
            </div>
          </div>
          <div v-else class="empty-hint">暂无消息，发送 prompt 后将自动提取</div>
        </el-card>
      </div>

      <!-- 右侧 Webview 区域 -->
      <div class="webview-panel">
        <div class="webview-container" v-if="showWebview">
          <webview
            id="doubao-webview"
            :src="webviewSrc"
            :preload="preloadPath"
            partition="persist:doubao"
            allowpopups
            websecurity="true"
          ></webview>
        </div>
        <div v-else class="webview-placeholder">
          <el-icon :size="48" color="#c0c4cc">
            <Document />
          </el-icon>
          <p>点击「连接豆包」加载网页版</p>
          <p class="sub">豆包将以 webview 形式嵌入此窗口</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.doubao-view {
  height: 100%;
  padding: 16px;
  display: flex;
  flex-direction: column;
}

.view-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.view-header h2 {
  margin: 0;
  font-size: 18px;
}

.layout {
  flex: 1;
  display: flex;
  gap: 16px;
  min-height: 0;
}

.control-panel {
  width: 380px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
}

.webview-panel {
  flex: 1;
  background: #fff;
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.webview-container {
  flex: 1;
  position: relative;
}

.webview-container webview {
  width: 100%;
  height: 100%;
  border: none;
}

.webview-placeholder {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #909399;
  gap: 8px;
}

.webview-placeholder .sub {
  font-size: 12px;
  color: #c0c4cc;
}

.control-card,
.xml-card,
.messages-card {
  flex-shrink: 0;
}

.xml-card {
  max-height: 260px;
}

.xml-output {
  margin: 0;
  font-size: 11px;
  font-family: 'Consolas', 'Monaco', monospace;
  max-height: 180px;
  overflow: auto;
  background: #1e1e1e;
  color: #d4d4d4;
  padding: 10px;
  border-radius: 4px;
  white-space: pre-wrap;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.control-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.control-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.error-box {
  margin-top: 12px;
}

.diag-box {
  margin-top: 12px;
  padding: 10px;
  background: #f5f7fa;
  border-radius: 6px;
}

.diag-box code {
  font-size: 11px;
  word-break: break-all;
  background: #ebeef5;
  padding: 1px 4px;
  border-radius: 3px;
}

.diag-body {
  font-size: 11px;
  max-height: 80px;
  overflow: auto;
  background: #fff;
  padding: 6px;
  border-radius: 4px;
  margin: 0;
  white-space: pre-wrap;
}

.messages-card {
  flex-shrink: 1;
  min-height: 200px;
}

.message-list {
  max-height: 250px;
  overflow-y: auto;
}

.message-item {
  padding: 8px 10px;
  margin-bottom: 8px;
  border-radius: 6px;
  background: #f5f7fa;
  display: flex;
  gap: 8px;
  align-items: flex-start;
}

.message-item.user {
  background: #ecf5ff;
}

.message-item .msg-content {
  font-size: 13px;
  line-height: 1.5;
  word-break: break-word;
}

.empty-hint {
  text-align: center;
  color: #909399;
  font-size: 12px;
  padding: 20px;
}
</style>