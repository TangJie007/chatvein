<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import AgentListPane from './panes/AgentListPane.vue'
import ViewShell from '../components/layout/ViewShell.vue'
import Card from '../components/ui/Card.vue'
import Field from '../components/ui/Field.vue'
import TextInput from '../components/ui/TextInput.vue'
import TextArea from '../components/ui/TextArea.vue'
import SelectInput from '../components/ui/SelectInput.vue'
import KvRow from '../components/ui/KvRow.vue'
import ChipPick from '../components/ui/ChipPick.vue'
import AppButton from '../components/ui/AppButton.vue'
import Tag from '../components/ui/Tag.vue'
import Avatar from '../components/ui/Avatar.vue'
import SwitchToggle from '../components/ui/SwitchToggle.vue'
import { useAgents } from '../composables/useAgents'
import { useModels } from '../composables/useModels'
import type { AgentConfig, AgentInput, AvatarTint } from '../ipc-api'
import { setCrumbItem } from '../composables/useUi'
import { RouterLink } from 'vue-router'

const store = useAgents()
const models = useModels()

const currentId = ref<string>('')
const form = reactive<AgentForm>(emptyForm())

interface AgentForm {
  id: string
  isMain: boolean
  name: string
  role: string
  desc: string
  initial: string
  tint: AvatarTint
  modelId: string
  enabled: boolean
  tools: string[]
  skills: string[]
  kbs: string[]
  systemPrompt: string
}

function emptyForm(): AgentForm {
  return {
    id: '',
    isMain: false,
    name: '',
    role: '',
    desc: '',
    initial: '',
    tint: 'indigo',
    modelId: '',
    enabled: true,
    tools: [],
    skills: [],
    kbs: [],
    systemPrompt: '',
  }
}

const current = computed(() => store.agents.find((a) => a.id === currentId.value))

const modelOptions = computed(() => {
  const enabled = models.models.filter((m) => m.enabled)
  const opts = enabled.map((m) => ({
    value: m.id,
    label: `${m.name} · ${m.model}`,
  }))
  // 若当前绑定的模型已停用/删除，仍保留选项便于用户看见并更换
  if (form.modelId && !opts.some((o) => o.value === form.modelId)) {
    const orphan = models.findById(form.modelId)
    opts.unshift({
      value: form.modelId,
      label: orphan ? `${orphan.name}（已停用）` : '（模型已删除，请重新选择）',
    })
  }
  if (!form.modelId) {
    opts.unshift({ value: '', label: '请选择模型…' })
  }
  return opts
})

const selectedModel = computed(() => (form.modelId ? models.findById(form.modelId) : undefined))
const modelTag = computed(() => {
  if (!form.modelId) return '未选模型'
  const m = selectedModel.value
  return m ? m.name : '模型缺失'
})

const allTools = ['file_search', 'file_read', 'file_write', 'rag_query', 'obsidian_sync', 'browser_open', 'github_pr', 'ssh_deploy']
const allSkills = ['prd-to-spec', 'extract-image-palette', 'wenwei-对齐', 'excel-handler']
const allKbs = [
  { v: 'rag-notes', label: 'RAG 工程笔记' },
  { v: 'medical', label: '医疗健康科普' },
  { v: 'lingscape', label: '灵境产品文档' },
]

const saving = ref(false)
const foot = ref('模型在「模型选型」中统一管理 · Agent 只绑定选用')
const dirty = ref(false)

function markDirty() {
  dirty.value = true
}

function loadIntoForm(a: AgentConfig) {
  Object.assign(form, {
    id: a.id,
    isMain: !!a.isMain,
    name: a.name,
    role: a.role,
    desc: a.desc,
    initial: a.initial,
    tint: a.tint,
    modelId: a.modelId ?? '',
    enabled: a.enabled,
    tools: [...a.tools],
    skills: [...a.skills],
    kbs: [...a.knowledgeBases],
    systemPrompt: a.systemPrompt,
  })
  dirty.value = false
}

function onSelect(a: AgentConfig) {
  currentId.value = a.id
  loadIntoForm(a)
  setCrumbItem(a.isMain ? `主对话 · ${a.name}` : `${a.name} · ${a.role}`)
}

function modelLabelFor(agent: AgentConfig): string {
  if (!agent.modelId) return '未选模型'
  const m = models.findById(agent.modelId)
  return m ? m.name : '模型缺失'
}

function toggle(list: 'tools' | 'skills' | 'kbs', v: string) {
  const arr = form[list]
  const i = arr.indexOf(v)
  if (i > -1) arr.splice(i, 1)
  else arr.push(v)
  markDirty()
}

function collectPatch(): AgentInput {
  return {
    name: form.name,
    role: form.role,
    desc: form.desc,
    initial: form.initial || form.name.trim()[0] || 'A',
    tint: form.tint,
    modelId: form.modelId,
    enabled: form.isMain ? true : form.enabled,
    tools: form.tools,
    skills: form.skills,
    knowledgeBases: form.kbs,
    systemPrompt: form.systemPrompt,
  }
}

async function save() {
  if (!form.id || saving.value) return
  saving.value = true
  try {
    const updated = await store.update(form.id, collectPatch())
    loadIntoForm(updated)
    const d = new Date()
    foot.value = `已保存 · ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch (e) {
    foot.value = `保存失败：${(e as Error).message}`
  } finally {
    saving.value = false
  }
}

function discard() {
  if (current.value) loadIntoForm(current.value)
}

async function createAgent() {
  const defaultModelId = models.models.find((m) => m.enabled)?.id ?? ''
  const created = await store.create({
    name: `新 Agent ${store.agents.length + 1}`,
    modelId: defaultModelId,
  })
  currentId.value = created.id
  loadIntoForm(created)
  setCrumbItem(`${created.name} · ${created.role}`)
  dirty.value = true
}

async function removeAgent() {
  if (!form.id || form.isMain) return
  if (!window.confirm(`删除角色「${form.name}」？该操作不可撤销。`)) return
  await store.remove(form.id)
  const next = store.agents.find((a) => a.isMain) ?? store.agents[0]
  if (next) onSelect(next)
}

onMounted(async () => {
  await Promise.all([
    store.loaded ? Promise.resolve() : store.refresh(),
    models.loaded ? Promise.resolve() : models.refresh(),
  ])
  const main = store.agents.find((a) => a.isMain) ?? store.agents[0]
  if (main) {
    currentId.value = main.id
    loadIntoForm(main)
    setCrumbItem(`主对话 · ${main.name}`)
  }
})
</script>

<template>
  <AgentListPane
    :agents="store.agents"
    :model-value="currentId"
    :loading="store.loading"
    :model-label="modelLabelFor"
    @select="onSelect"
    @add="createAgent"
  />

  <ViewShell :foot-note="foot">
    <template #identity>
      <Avatar :initial="form.initial" :tint="form.tint" size="lg" :dot="form.enabled ? 'thinking' : 'idle'" />
      <div>
        <div class="font-serif text-[22px] leading-[1.15] tracking-[0.2px] text-[var(--color-ink-1)]">
          {{ form.name || '未命名' }} · <em class="italic" style="color: var(--color-brand-deep)">{{ form.role || '未设置定位' }}</em>
        </div>
        <div class="mt-[3px] flex items-center gap-2">
          <Tag v-if="form.isMain" tone="brand" sm>主对话</Tag>
          <Tag tone="brand" sm>{{ modelTag }}</Tag>
          <Tag v-if="selectedModel" sm class="font-mono">{{ selectedModel.model }}</Tag>
          <Tag :tone="form.enabled ? 'ok' : 'default'" sm>{{ form.enabled ? '已启用' : '已停用' }}</Tag>
        </div>
      </div>
    </template>
    <template #actions>
      <AppButton v-if="!form.isMain" size="sm" variant="ghost" @click="removeAgent">删除</AppButton>
      <SwitchToggle
        :model-value="form.enabled"
        :label="form.isMain ? '主对话始终启用' : '启用该 Agent'"
        :disabled="form.isMain"
        @update:model-value="(v: boolean) => { form.enabled = v; markDirty() }"
      />
    </template>

    <Card idx="1" title="身份" side="identity">
      <div class="grid grid-cols-2 gap-3.5">
        <Field label="名称"><TextInput v-model="form.name" placeholder="如 Terry" @input="markDirty" /></Field>
        <Field label="定位"><TextInput v-model="form.role" placeholder="如 日常任务助理" @input="markDirty" /></Field>
      </div>
      <div class="mt-3.5">
        <Field label="简介（给群组和路由用）"><TextInput v-model="form.desc" @input="markDirty" /></Field>
      </div>
    </Card>

    <Card idx="2" title="模型" side="从模型选型中选用">
      <Field label="选用模型" hint="连接与 Key 在「模型选型」中统一配置">
        <SelectInput
          v-model="form.modelId"
          :options="modelOptions"
          @update:model-value="markDirty"
        />
      </Field>
      <div v-if="selectedModel" class="mt-3.5 grid grid-cols-3 gap-3 text-xs text-[var(--color-ink-2)]">
        <div>
          <div class="text-[10.5px] uppercase tracking-[0.4px] text-[var(--color-ink-3)]">Provider</div>
          <div class="mt-0.5">{{ models.presetLabel(selectedModel.provider) }}</div>
        </div>
        <div>
          <div class="text-[10.5px] uppercase tracking-[0.4px] text-[var(--color-ink-3)]">温度</div>
          <div class="mt-0.5 font-mono">{{ selectedModel.temperature.toFixed(2) }}</div>
        </div>
        <div>
          <div class="text-[10.5px] uppercase tracking-[0.4px] text-[var(--color-ink-3)]">Max tokens</div>
          <div class="mt-0.5 font-mono">{{ selectedModel.maxTokens }}</div>
        </div>
      </div>
      <div class="mt-3 text-xs text-[var(--color-ink-3)]">
        没有合适的模型？
        <RouterLink to="/models" class="text-[var(--color-brand-deep)] underline-offset-2 hover:underline">去模型选型添加</RouterLink>
      </div>
    </Card>

    <Card idx="3" title="能力绑定" side="tools · skills · kb">
      <Field label="工具（来自 MCP 与内置）">
        <div class="flex flex-wrap gap-1.5">
          <ChipPick v-for="t in allTools" :key="t" :model-value="form.tools.includes(t)" :value="t" @update:model-value="toggle('tools', t)">{{ t }}</ChipPick>
        </div>
      </Field>
      <div class="mt-3.5 grid grid-cols-2 gap-3.5">
        <Field label="Skills">
          <div class="flex flex-wrap gap-1.5">
            <ChipPick v-for="s in allSkills" :key="s" :model-value="form.skills.includes(s)" :value="s" @update:model-value="toggle('skills', s)">{{ s }}</ChipPick>
          </div>
        </Field>
        <Field label="知识库">
          <div class="flex flex-wrap gap-1.5">
            <ChipPick v-for="k in allKbs" :key="k.v" :model-value="form.kbs.includes(k.v)" :value="k.v" @update:model-value="toggle('kbs', k.v)">{{ k.label }}</ChipPick>
          </div>
        </Field>
      </div>
    </Card>

    <Card idx="4" title="系统提示词" side="支持变量">
      <TextArea v-model="form.systemPrompt" mono @input="markDirty" />
      <div class="mt-2 flex flex-wrap gap-1.5">
        <Tag sm v-pre>{{workspace}}</Tag>
        <Tag sm v-pre>{{user.name}}</Tag>
        <Tag sm v-pre>{{now}}</Tag>
      </div>
    </Card>

    <Card idx="5" title="护栏" side="guardrails">
      <KvRow k="写入前二次确认" sub="文件覆盖、批量删除、git 强推">
        <span class="font-mono text-xs text-[var(--color-ink-3)]">全局设置</span>
      </KvRow>
      <KvRow k="沙箱执行" sub="命令只允许在 workspace 目录内">
        <span class="font-mono text-xs text-[var(--color-ink-3)]">全局设置</span>
      </KvRow>
      <KvRow k="单轮预算上限" sub="超过即停下并汇报，不继续烧钱" mono>¥ 1.50 / 轮</KvRow>
    </Card>

    <template #footer>
      <div class="flex items-center gap-2">
        <AppButton @click="discard">放弃更改</AppButton>
        <AppButton variant="primary" :disabled="saving" @click="save">
          {{ saving ? '保存中…' : dirty ? '保存角色' : '已保存' }}
        </AppButton>
      </div>
    </template>
  </ViewShell>
</template>
