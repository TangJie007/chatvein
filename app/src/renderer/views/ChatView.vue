<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import ConversationPane from './panes/ConversationPane.vue'
import ChatMessage from '../components/chat/ChatMessage.vue'
import Composer from '../components/chat/Composer.vue'
import ThinkingPanel from '../components/chat/ThinkingPanel.vue'
import ChipButton from '../components/ui/ChipButton.vue'
import ConfirmDialog from '../components/ui/ConfirmDialog.vue'
import AppIcon from '../components/AppIcon.vue'
import Avatar from '../components/ui/Avatar.vue'
import { useChat } from '../composables/useChat'
import { useAgents } from '../composables/useAgents'
import { useModels } from '../composables/useModels'
import { useSettings } from '../composables/useSettings'
import { setCrumbItem } from '../composables/useUi'
import type { AvatarTint, ChatAttachment, Conversation } from '../ipc-api'

const router = useRouter()
const chat = useChat()
const agents = useAgents()
const models = useModels()
const settingsStore = useSettings()

const scroller = ref<HTMLElement | null>(null)
const status = ref('')
const draft = ref('')
/** 右侧「Trace / 思考流」面板是否展开（Trace 按钮切换） */
const tracePanelOpen = ref(true)

/** 删除对话：应用内确认（避免 Electron 无边框窗口上 window.confirm 抢焦点） */
const removeConfirmOpen = ref(false)
const removeBusy = ref(false)
const pendingRemoveId = ref('')
const pendingRemoveTitle = ref('')
/** Forge 启动前二次确认 */
const forgeConfirmOpen = ref(false)
const pendingForgeText = ref('')
/** 编程档：待发送的需求文档附件（本机路径，不写入项目仓） */
const pendingAttachments = ref<ChatAttachment[]>([])
/** 删除 IPC 超过此时长仍未返回：关弹窗释放 UI，后台继续，不阻塞后续操作 */
const REMOVE_TIMEOUT_MS = 10_000

const mainAgent = computed(() => agents.agents.find((a) => a.isMain) ?? agents.agents[0])
const activeAgent = computed(() => {
  const id = chat.current?.agentId || mainAgent.value?.id
  return agents.agents.find((a) => a.id === id) ?? mainAgent.value
})
const activeModel = computed(() => {
  const id = activeAgent.value?.modelId
  return id ? models.findById(id) : undefined
})

const messages = computed(() => chat.current?.messages ?? [])

// ---- 三档工作模式：日常办公 / 编程开发 / 个性化 Agent ----
type WorkMode = 'office' | 'code' | 'custom'
const WORK_MODE_STORAGE_KEY = 'chatvein.workMode'

const workModes: Array<{
  value: WorkMode
  label: string
  icon: string
  hint: string
}> = [
  { value: 'office', label: '日常办公', icon: 'briefcase', hint: '日常沟通、文档、表格与快速问答' },
  { value: 'code', label: '编程开发', icon: 'code', hint: 'Forge 编排：实现→验证→修复' },
  { value: 'custom', label: '个性化Agent', icon: 'robot', hint: '你在 Agents 中自定义的专属角色' },
]

function loadStoredMode(): WorkMode {
  try {
    const v = localStorage.getItem(WORK_MODE_STORAGE_KEY)
    return v === 'code' || v === 'custom' ? v : 'office'
  } catch {
    return 'office'
  }
}

/**
 * 当前所选工作模式。
 * 注意：「对话」场景下三档切换只表达用户意图 / 偏好，统一由主 Agent（main）接待，
 * 不会更改会话绑定的 Agent。具体角色 Agent（CodeReview 等）是为后续「群组模式」准备的，
 * 与单聊无关。
 *
 * 单会话一旦有聊天（或已写入 workMode），模式锁定，不能再切换；换模式请新建对话。
 */
const preferredMode = ref<WorkMode>(loadStoredMode())

/** 本会话已开聊或已锁定 → 禁止切换档位 */
const modeLocked = computed(() => {
  const c = chat.current
  if (!c) return false
  return Boolean(c.workMode) || c.messages.length > 0
})

/** 有锁定态用会话 workMode；否则用本地偏好 */
const activeMode = computed<WorkMode>(() => {
  const locked = chat.current?.workMode
  if (locked === 'office' || locked === 'code' || locked === 'custom') return locked
  return preferredMode.value
})

function onModeChange(mode: WorkMode) {
  if (chat.sending || modeLocked.value || mode === preferredMode.value) return
  preferredMode.value = mode
  try {
    localStorage.setItem(WORK_MODE_STORAGE_KEY, mode)
  } catch {
    // localStorage 不可用时仅本次会话生效
  }
  status.value = `已切换到「${workModes.find((m) => m.value === mode)?.label}」· ${
    mode === 'code' ? 'Forge 编排（orchestrator）' : '主对话 ReAct'
  }`
}

function syncModeFromConversation(c: Conversation | null | undefined) {
  if (!c) return
  if (c.workMode === 'office' || c.workMode === 'code' || c.workMode === 'custom') {
    preferredMode.value = c.workMode
  }
}

// 编程开发模式：项目根目录（工具 jail 根）。未设置时工具只能在会话沙箱内运行
const devProjectRoot = computed(() => settingsStore.settings?.devProjectRoot?.trim() ?? '')
const projectFolderName = computed(() => {
  const p = devProjectRoot.value
  if (!p) return ''
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] || p
})

async function pickProjectFolder() {
  if (chat.sending) return
  try {
    const picked = await settingsStore.pickFolder({
      title: '选择编程开发的项目根目录',
      defaultPath: devProjectRoot.value || undefined,
    })
    if (!picked) return
    await settingsStore.update({ devProjectRoot: picked })
    status.value = `编程开发将作用于项目：${picked}`
  } catch (e) {
    status.value = (e as Error).message || '选择项目目录失败'
  }
}

async function clearProjectFolder() {
  if (chat.sending) return
  try {
    await settingsStore.update({ devProjectRoot: '' })
    status.value = '已清除项目目录；编程工具回到会话沙箱'
  } catch (e) {
    status.value = (e as Error).message || '清除项目目录失败'
  }
}

// 思考面板：运行中显示实时流；结束后 / 点击气泡显示对应日志
const panelActive = computed(
  () => chat.thinking.active && chat.thinking.conversationId === chat.currentId,
)
const panelThought = computed(() => {
  if (chat.thinking.conversationId && chat.thinking.conversationId !== chat.currentId) return ''
  if (panelActive.value) return chat.thinking.text
  if (chat.selectedThinkingMessageId) return chat.thinking.text
  return ''
})

async function onSelectThinking(messageId: string, role: string): Promise<void> {
  if (role !== 'assistant' || chat.sending) return
  await chat.selectThinking(messageId)
  if (!tracePanelOpen.value) tracePanelOpen.value = true
}

function toggleTrace() {
  tracePanelOpen.value = !tracePanelOpen.value
}

function openSettings() {
  void router.push('/settings')
}

function onMemory() {
  // 记忆能力（docs/design/03）尚未落地，先给出诚实提示而非假入口
  status.value = '记忆模块尚未上线（见 docs/design/03-记忆方案）'
}

function agentLabel(agentId: string): string {
  return agents.agents.find((a) => a.id === agentId)?.name ?? agentId
}
function agentInitial(agentId: string): string {
  return agents.agents.find((a) => a.id === agentId)?.initial ?? 'A'
}
function agentTint(agentId: string): AvatarTint {
  return agents.agents.find((a) => a.id === agentId)?.tint ?? 'indigo'
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function formatTokenLabel(m: {
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number }
  latencyMs?: number
}): string {
  const parts: string[] = []
  if (m.latencyMs != null && m.latencyMs > 0) {
    parts.push(formatLatency(m.latencyMs))
  }
  const u = m.usage
  if (u && u.totalTokens > 0) {
    parts.push(`${formatCount(u.totalTokens)} tok`)
  }
  return parts.join(' · ')
}

function formatTokenTitle(m: {
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number }
  latencyMs?: number
}): string {
  const parts: string[] = []
  if (m.latencyMs != null && m.latencyMs > 0) {
    parts.push(`耗时 ${formatLatency(m.latencyMs)}`)
  }
  const u = m.usage
  if (u && u.totalTokens > 0) {
    parts.push(
      `输入 ${formatCount(u.promptTokens)} · 输出 ${formatCount(u.completionTokens)} · 合计 ${formatCount(u.totalTokens)}`,
    )
  }
  return parts.join('\n')
}

function formatLatency(ms: number): string {
  if (ms < 1000) return `${ms} ms`
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`
}

function formatCount(n: number): string {
  return n.toLocaleString('en-US')
}

async function scrollBottom() {
  await nextTick()
  const el = scroller.value
  if (el) el.scrollTop = el.scrollHeight
}

function onSelect(c: Conversation) {
  void chat.select(c.id)
  syncModeFromConversation(c)
  setCrumbItem(c.title)
}

async function onAdd() {
  // 单聊始终使用主 Agent；模式档仅记录偏好，不改变绑定
  const created = await chat.create({ agentId: mainAgent.value?.id })
  // 新会话未锁定，沿用当前 preferredMode（localStorage）
  setCrumbItem(created.title)
  status.value = `已新建 · ${created.slug}`
  await scrollBottom()
}

function onRemove(id: string) {
  const target = chat.conversations.find((c) => c.id === id)
  if (!target) return
  pendingRemoveId.value = id
  pendingRemoveTitle.value = target.title
  removeBusy.value = false
  removeConfirmOpen.value = true
}

function onRemoveCancel() {
  if (removeBusy.value) return
  removeConfirmOpen.value = false
  pendingRemoveId.value = ''
  pendingRemoveTitle.value = ''
}

async function onRemoveConfirm() {
  const id = pendingRemoveId.value
  if (!id || removeBusy.value) return
  removeBusy.value = true

  const removePromise = chat.remove(id)
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<'timeout'>((resolve) => {
    timeoutId = setTimeout(() => resolve('timeout'), REMOVE_TIMEOUT_MS)
  })

  try {
    const outcome = await Promise.race([
      removePromise.then(() => 'ok' as const),
      timeoutPromise,
    ])
    if (timeoutId != null) clearTimeout(timeoutId)

    if (outcome === 'timeout') {
      // 释放弹窗与 busy，后台删除继续；成功/失败只更新状态栏
      removeConfirmOpen.value = false
      pendingRemoveId.value = ''
      pendingRemoveTitle.value = ''
      removeBusy.value = false
      status.value = '删除较慢，已关闭确认框；后台仍在处理'
      void removePromise
        .then(() => {
          status.value = '已删除对话'
          setCrumbItem(chat.current?.title || '对话')
        })
        .catch((e) => {
          status.value = (e as Error).message || '删除失败'
        })
      return
    }

    status.value = '已删除对话'
    setCrumbItem(chat.current?.title || '对话')
    removeConfirmOpen.value = false
    pendingRemoveId.value = ''
    pendingRemoveTitle.value = ''
  } catch (e) {
    if (timeoutId != null) clearTimeout(timeoutId)
    status.value = (e as Error).message || '删除失败'
    removeBusy.value = false
  }
}

async function onSend(text: string) {
  if (!activeModel.value) {
    status.value = '请先在 Agents 中绑定模型并填写 API Key'
    return
  }
  if (!text.trim() && pendingAttachments.value.length === 0) {
    status.value = '请输入需求描述，或上传需求文档'
    return
  }
  const needsForgeConfirm =
    activeMode.value === 'code' &&
    settingsStore.settings?.confirmForgeStart !== false &&
    (pendingAttachments.value.length > 0 ||
      (text.trim().length >= 12 &&
        /实现|添加|新增|修复|重构|改写|编写|写一|写个|创建|删除|优化|升级|迁移|接入|集成|bug|fix|implement|refactor|add\s|create\s|update\s|patch|初始化|脚手架/i.test(
          text,
        )))
  if (needsForgeConfirm) {
    pendingForgeText.value = text
    forgeConfirmOpen.value = true
    return
  }
  await doSend(text)
}

async function doSend(text: string, opts?: { resumeForge?: boolean }) {
  const attachments = [...pendingAttachments.value]
  draft.value = ''
  pendingAttachments.value = []
  status.value = activeMode.value === 'code' ? 'Forge 运行中…' : '生成中…'
  await scrollBottom()
  try {
    const result = await chat.send(text, activeMode.value, {
      ...opts,
      attachments: attachments.length ? attachments : undefined,
    })
    if (result.failed) {
      status.value = '回复失败 · 可点击「重试」或「继续上次」'
    } else {
      status.value =
        activeMode.value === 'code'
          ? `Forge 完成 · ${result.latencyMs} ms · ${result.model}`
          : `完成 · ${result.latencyMs} ms · ${result.model}`
    }
    setCrumbItem(result.conversation.title)
    await scrollBottom()
  } catch (e) {
    status.value = (e as Error).message || '回复失败 · 可点击「重试」'
    await scrollBottom()
  }
}

async function onForgeConfirm() {
  forgeConfirmOpen.value = false
  const text = pendingForgeText.value
  pendingForgeText.value = ''
  await doSend(text)
}

function onForgeCancel() {
  forgeConfirmOpen.value = false
  pendingForgeText.value = ''
}

function fileBaseName(p: string): string {
  const norm = p.replace(/\\/g, '/')
  const i = norm.lastIndexOf('/')
  return i >= 0 ? norm.slice(i + 1) : norm
}

async function pickRequirementDoc() {
  if (chat.sending) return
  const path = await settingsStore.pickFile({
    title: '选择需求文档（赛事）',
    filters: [
      { name: '需求文档', extensions: ['md', 'markdown', 'txt'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  })
  if (!path) return
  if (pendingAttachments.value.some((a) => a.path === path)) {
    status.value = '该文档已添加'
    return
  }
  pendingAttachments.value = [
    ...pendingAttachments.value,
    { path, name: fileBaseName(path), kind: 'requirement' },
  ]
  status.value = `已添加需求文档：${fileBaseName(path)}`
}

function removePendingAttachment(path: string) {
  pendingAttachments.value = pendingAttachments.value.filter((a) => a.path !== path)
}

async function onStop() {
  status.value = '正在停止…'
  await chat.abort()
}

async function onResumeForge() {
  if (!activeModel.value) {
    status.value = '请先在 Agents 中绑定模型并填写 API Key'
    return
  }
  if (!devProjectRoot.value) {
    status.value = '请先选择项目根目录'
    return
  }
  await doSend('继续上次', { resumeForge: true })
}

async function onRetry(failedMessageId: string) {
  if (chat.sending) return
  status.value = '正在重试…'
  await scrollBottom()
  try {
    const result = await chat.retry(failedMessageId, activeMode.value)
    if (result.failed) {
      status.value = '回复仍失败 · 可再次重试'
    } else {
      status.value = `重试成功 · ${result.latencyMs} ms · ${result.model}`
    }
    setCrumbItem(result.conversation.title)
    await scrollBottom()
  } catch (e) {
    status.value = (e as Error).message || '重试失败'
    await scrollBottom()
  }
}

watch(
  () => messages.value.length,
  () => {
    void scrollBottom()
  },
)

watch(
  () => chat.currentId,
  () => {
    syncModeFromConversation(chat.current)
  },
)

onMounted(async () => {
  await Promise.all([
    agents.loaded ? Promise.resolve() : agents.refresh(),
    models.loaded ? Promise.resolve() : models.refresh(),
    chat.loaded ? Promise.resolve() : chat.refresh(),
    settingsStore.loaded ? Promise.resolve() : settingsStore.refresh(),
  ])
  // 新装/空库：列表保持为空，由用户点「+」创建；不自动建会话
  if (chat.conversations.length && !chat.currentId) {
    await chat.select(chat.conversations[0].id)
  } else if (chat.currentId) {
    await chat.refreshArtifacts(chat.currentId)
  }
  const cur = chat.current
  syncModeFromConversation(cur)
  setCrumbItem(cur?.title || '对话')
  await scrollBottom()
})
</script>

<template>
  <ConversationPane
    :conversations="chat.conversations"
    :model-value="chat.currentId"
    :loading="chat.loading"
    :agent-label="agentLabel"
    :agent-initial="agentInitial"
    :agent-tint="agentTint"
    @select="onSelect"
    @add="onAdd"
    @remove="onRemove"
  />

  <main
    class="relative grid min-h-0 min-w-0 overflow-hidden"
    style="
      grid-template-columns: minmax(0, 1fr) auto;
      background:
        radial-gradient(80% 40% at 50% 0%, rgb(254 254 254 / 0.85), transparent 70%),
        var(--color-canvas);
    "
  >
    <section class="grid h-full min-h-0" style="grid-template-rows: auto 1fr auto">
      <header class="flex flex-col">
        <div class="flex items-center justify-between gap-4 px-[26px] pb-3 pt-4">
          <div class="flex min-w-0 items-center gap-3">
            <Avatar
              :initial="activeAgent?.initial || 'A'"
              :tint="activeAgent?.tint || 'indigo'"
              size="lg"
              :dot="chat.sending ? 'thinking' : activeAgent?.enabled ? 'online' : 'idle'"
            />
            <div class="min-w-0">
              <div class="truncate font-serif text-[22px] leading-[1.15] tracking-[0.2px] text-[var(--color-ink-1)]">
                {{ activeAgent?.name || '未配置 Agent' }} ·
                <em class="italic" style="color: var(--color-brand-deep)">{{ activeAgent?.role || '—' }}</em>
              </div>
              <div class="mt-[3px] flex flex-wrap items-center gap-2">
                <span
                  class="rounded-full bg-[var(--color-brand-soft)] px-2.5 py-[3px] font-mono text-[11px] font-medium text-[var(--color-brand-dark)]"
                >
                  {{ chat.current?.title || '新对话' }}
                </span>
                <span class="font-mono text-[11px] text-[var(--color-ink-3)]">
                  {{ activeModel ? `${activeModel.name} · ${activeModel.model}` : '未绑定模型' }}
                </span>
              </div>
            </div>
          </div>
          <div class="flex shrink-0 items-center gap-3 text-xs font-medium text-[var(--color-ink-2)]">
            <template v-if="chat.sending">
              <span class="inline-flex items-center gap-1.5">
                <span class="h-[7px] w-[7px] rounded-full bg-[var(--color-brand)] dot-thinking" />
                正在生成…
              </span>
            </template>
            <template v-else-if="status">
              <span class="max-w-[260px] truncate font-mono text-[11px] text-[var(--color-ink-3)]">{{ status }}</span>
            </template>
            <div class="flex items-center gap-1">
              <ChipButton :accent="tracePanelOpen" @click="toggleTrace">
                <AppIcon name="chart" :size="13" /> Trace
              </ChipButton>
              <ChipButton @click="onMemory">
                <AppIcon name="history" :size="13" /> 记忆
              </ChipButton>
              <ChipButton @click="openSettings">
                <AppIcon name="gear" :size="13" /> 设置
              </ChipButton>
            </div>
          </div>
        </div>

        <!-- 工作模式三档：空会话可切；一旦有聊天则锁定本会话模式 -->
        <div
          class="mx-[26px] mt-1 inline-flex w-fit items-center gap-0.5 rounded-full border border-[var(--color-line)] bg-[var(--color-track)] p-[3px]"
          role="tablist"
          aria-label="工作模式切换"
          :title="modeLocked ? '本会话已开聊，模式已锁定；换模式请新建对话' : undefined"
        >
          <button
            v-for="m in workModes"
            :key="m.value"
            type="button"
            role="tab"
            :aria-selected="activeMode === m.value"
            :title="modeLocked && activeMode !== m.value ? '本会话模式已锁定' : m.hint"
            :disabled="chat.sending || (modeLocked && activeMode !== m.value)"
            class="inline-flex items-center gap-1.5 rounded-full border-0 px-3.5 py-[5px] text-xs font-medium transition-all duration-200 ease-[var(--ease-soft)] focus-visible:outline-2 focus-visible:outline-[var(--color-brand)] focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            :class="
              activeMode === m.value
                ? 'bg-[var(--color-elevated)] text-[var(--color-brand-dark)] shadow-[var(--shadow-1)]'
                : 'bg-transparent text-[var(--color-ink-3)] hover:text-[var(--color-ink-1)]'
            "
            @click="onModeChange(m.value)"
          >
            <AppIcon :name="m.icon" :size="13" :stroke-width="1.9" />
            {{ m.label }}
          </button>
        </div>

        <!-- 编程开发模式：项目目录选择。文件读写 / 脚本执行工具将 jail 到该项目根 -->
        <div
          v-if="activeMode === 'code'"
          class="mx-[26px] mt-2 flex w-fit max-w-full items-center gap-2 rounded-[10px] border border-[var(--color-line)] bg-[var(--color-elevated)] px-3 py-1.5"
        >
          <AppIcon name="folder" :size="14" class="shrink-0 text-[var(--color-brand-deep)]" />
          <template v-if="devProjectRoot">
            <span class="text-xs font-medium text-[var(--color-ink-1)]">项目：{{ projectFolderName }}</span>
            <span class="max-w-[280px] truncate font-mono text-[11px] text-[var(--color-ink-3)]" :title="devProjectRoot">
              {{ devProjectRoot }}
            </span>
            <button
              type="button"
              class="rounded-md border-0 bg-transparent px-1.5 py-0.5 text-[11px] font-medium text-[var(--color-ink-3)] transition hover:text-[var(--color-brand-dark)] focus-visible:outline-2 focus-visible:outline-[var(--color-brand)] disabled:opacity-60"
              :disabled="chat.sending"
              title="重新选择项目目录"
              @click="pickProjectFolder"
            >
              更换
            </button>
            <button
              type="button"
              class="rounded-md border-0 bg-transparent px-1.5 py-0.5 text-[11px] font-medium text-[var(--color-ink-3)] transition hover:text-rose-600 focus-visible:outline-2 focus-visible:outline-[var(--color-brand)] disabled:opacity-60"
              :disabled="chat.sending"
              title="清除后工具仅在会话沙箱内运行，无法访问真实项目"
              @click="clearProjectFolder"
            >
              清除
            </button>
            <button
              type="button"
              class="rounded-md border border-[var(--color-line)] bg-[var(--color-input)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-brand-dark)] transition hover:border-[var(--color-brand)] disabled:opacity-60"
              :disabled="chat.sending"
              title="从上次 Forge checkpoint 续跑"
              @click="onResumeForge"
            >
              继续上次
            </button>
          </template>
          <template v-else>
            <span class="text-xs text-[var(--color-ink-3)]">未选择项目目录，工具将在会话沙箱内运行</span>
            <button
              type="button"
              class="inline-flex items-center gap-1 rounded-full border-0 bg-[var(--color-brand-soft)] px-2.5 py-1 text-[11px] font-medium text-[var(--color-brand-dark)] transition hover:bg-[var(--color-brand-mist)] focus-visible:outline-2 focus-visible:outline-[var(--color-brand)] disabled:opacity-60"
              :disabled="chat.sending"
              @click="pickProjectFolder"
            >
              <AppIcon name="folder" :size="12" /> 选择项目目录
            </button>
          </template>
        </div>
      </header>

      <div
        ref="scroller"
        class="scroll-thin flex min-h-0 flex-col gap-[13px] overflow-y-auto px-[26px] pb-4 pt-2.5"
        aria-live="polite"
      >
        <div
          v-if="!messages.length && !chat.sending"
          class="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-center"
        >
          <div
            class="grid h-12 w-12 place-items-center rounded-[16px] text-[var(--color-brand-deep)]"
            style="background: linear-gradient(180deg, var(--color-brand-mist), rgb(233 236 249 / 0.55))"
          >
            <AppIcon name="chat" :size="22" />
          </div>
          <div class="font-serif text-lg text-[var(--color-ink-1)]">
            {{ chat.current ? '开始对话' : '暂无对话' }}
          </div>
          <p class="max-w-sm text-xs leading-relaxed text-[var(--color-ink-3)]">
            <template v-if="!chat.current">点击左侧「+」新建会话；将在工作区根下创建「时间戳」目录（含 runs/）。</template>
            <template v-else>
              <template v-if="activeMode === 'code'">
                编程开发走 Forge：在对话框描述需求，或上传需求文档（.md/.txt）并补充说明。需求写入会话
                memory，不进入项目仓。请先选择项目根目录。
              </template>
              <template v-else>
                消息将发送给「{{ activeAgent?.name || '主对话 Agent' }}」。
              </template>
              <template v-if="!activeModel">请先在 Agents 中为该角色绑定模型并填写 API Key。</template>
            </template>
          </p>
        </div>

        <div
          v-for="m in messages"
          :key="m.id"
          class="flex flex-col gap-1.5"
          :class="m.role === 'user' ? 'items-end' : 'items-start'"
        >
          <button
            v-if="m.role === 'assistant'"
            type="button"
            class="w-full rounded-[14px] border-0 bg-transparent p-0 text-left focus-visible:outline-2 focus-visible:outline-[var(--color-brand)] focus-visible:outline-offset-2"
            :title="'点击查看该回复的思考流'"
            @click="onSelectThinking(m.id, m.role)"
          >
            <ChatMessage
              role="agent"
              :initial="activeAgent?.initial || 'A'"
              :tint="activeAgent?.tint || 'indigo'"
              :author="activeAgent?.name"
              :role-mini="activeAgent?.role"
              :time="formatTime(m.createdAt)"
              :content="m.content"
              :token-label="!m.failed ? formatTokenLabel(m) : ''"
              :token-title="!m.failed ? formatTokenTitle(m) : ''"
              selectable
              :selected="chat.selectedThinkingMessageId === m.id"
            />
          </button>
          <ChatMessage
            v-else
            role="user"
            initial="我"
            tint="sky"
            :time="formatTime(m.createdAt)"
            :content="m.content"
          />
          <button
            v-if="m.failed && m.role === 'assistant' && !chat.sending"
            type="button"
            class="ml-11 rounded-[8px] border border-[var(--color-line)] bg-[var(--color-elevated)] px-2.5 py-1 text-[11.5px] font-medium text-[var(--color-ink-2)] shadow-[var(--shadow-1)] transition hover:border-[var(--color-brand)] hover:text-[var(--color-brand-deep)]"
            @click="onRetry(m.id)"
          >
            重试回复
          </button>
        </div>

        <div
          v-if="chat.sending"
          class="flex items-center gap-2 px-1 text-xs text-[var(--color-ink-3)]"
        >
          <span class="h-[7px] w-[7px] rounded-full bg-[var(--color-brand)] dot-thinking" />
          {{ activeAgent?.name || 'Agent' }} 正在回复…
        </div>
      </div>

      <Composer
        v-model="draft"
        :placeholder="
          activeMode === 'code'
            ? pendingAttachments.length
              ? '可补充说明（也可直接发送已上传的需求文档）…'
              : '描述需求，或点击回形针上传需求文档…'
            : `跟 ${activeAgent?.name || 'Agent'} 说点什么…`
        "
        :scope-label="activeModel ? activeModel.model : '未绑定模型'"
        :send-label="chat.sending ? '生成中' : activeMode === 'code' ? '启动 Forge' : '发送'"
        :hint="
          activeMode === 'code'
            ? '需求在对话框 · 改动在项目根 · Enter 发送'
            : 'Enter 发送 · Shift+Enter 换行'
        "
        :disabled="chat.sending"
        :stopping="chat.sending"
        :allow-empty-send="activeMode === 'code' && pendingAttachments.length > 0"
        @send="onSend"
        @stop="onStop"
      >
        <template #tools>
          <button
            v-if="activeMode === 'code'"
            type="button"
            class="inline-grid h-[30px] w-[30px] place-items-center rounded-[9px] border-0 bg-transparent text-[var(--color-brand)] transition hover:bg-[var(--color-hover)] disabled:opacity-50"
            aria-label="上传需求文档"
            title="上传赛事需求文档（.md / .txt）"
            :disabled="chat.sending"
            @click="pickRequirementDoc"
          >
            <AppIcon name="paperclip" :size="16" :stroke-width="2" />
          </button>
          <span v-else class="px-1 font-mono text-[11px] text-[var(--color-ink-3)]">一期 · 纯对话</span>
        </template>
        <template v-if="activeMode === 'code' && pendingAttachments.length" #attachments>
          <div class="flex flex-wrap gap-1.5">
            <span
              v-for="a in pendingAttachments"
              :key="a.path"
              class="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[var(--color-line)] bg-[var(--color-input)] py-0.5 pl-2.5 pr-1 text-[11px] text-[var(--color-ink-2)]"
              :title="a.path"
            >
              <span class="truncate">📎 {{ a.name || fileBaseName(a.path) }}</span>
              <button
                type="button"
                class="rounded-full border-0 bg-transparent px-1.5 text-[var(--color-ink-3)] hover:text-rose-600"
                :disabled="chat.sending"
                @click="removePendingAttachment(a.path)"
              >
                ×
              </button>
            </span>
          </div>
        </template>
        <template #footer-left>
          <span>· {{ activeAgent?.name || '—' }}</span>
        </template>
        <template #statbar>
          <span class="inline-flex items-center gap-1.5 before:h-[5px] before:w-[5px] before:rounded-full before:bg-[var(--color-brand)] before:content-['']">
            {{ activeModel?.name || '未配置模型' }}
          </span>
          <span class="inline-flex items-center gap-1.5 before:h-[5px] before:w-[5px] before:rounded-full before:bg-[var(--color-ok)] before:content-['']">
            历史 {{ messages.length }} 条
          </span>
        </template>
      </Composer>
    </section>

    <!-- AI 实时思考侧栏：reasoning 经 chat:event 流式推送；Trace 按钮切换显隐 -->
    <ThinkingPanel
      v-show="tracePanelOpen"
      :active="panelActive"
      :phase="chat.thinking.phase"
      :agent="chat.thinking.agent"
      :thought="panelThought"
      :artifacts="chat.artifacts"
      :conversation-id="chat.currentId"
      :selected-message-id="chat.selectedThinkingMessageId"
      @removed="chat.dropArtifact"
    />
  </main>

  <ConfirmDialog
    :open="removeConfirmOpen"
    :title="`删除对话「${pendingRemoveTitle}」？`"
    description="将同时移除该会话目录（含 runs/）与聊天历史。"
    confirm-label="删除"
    busy-label="正在删除…"
    cancel-label="取消"
    danger
    :busy="removeBusy"
    @close="onRemoveCancel"
    @confirm="onRemoveConfirm"
  />

  <ConfirmDialog
    :open="forgeConfirmOpen"
    title="在真实项目中启动 Forge？"
    :description="`将在「${projectFolderName || '所选项目'}」内实现、构建与测试。可在设置中关闭此确认。`"
    confirm-label="开始编排"
    cancel-label="取消"
    @close="onForgeCancel"
    @confirm="onForgeConfirm"
  />
</template>
