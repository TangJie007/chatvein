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
import ChipButton from '../components/ui/ChipButton.vue'
import SwitchToggle from '../components/ui/SwitchToggle.vue'
import AppButton from '../components/ui/AppButton.vue'
import Tag from '../components/ui/Tag.vue'
import Avatar from '../components/ui/Avatar.vue'
import AppIcon from '../components/AppIcon.vue'
import { agents as agentList } from '../data/lists'
import type { AgentRow } from '../data/types'
import { setCrumbItem } from '../composables/useUi'

const providers: Record<string, { label: string; base: string; models: string[] }> = {
  deepseek: { label: 'DeepSeek', base: 'https://api.deepseek.com/v1', models: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-coder'] },
  openai: { label: 'OpenAI', base: 'https://api.openai.com/v1', models: ['gpt-4o', 'gpt-4.1', 'gpt-4o-mini', 'o3-mini'] },
  anthropic: { label: 'Anthropic', base: 'https://api.anthropic.com/v1', models: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-haiku-4-5'] },
  qwen: { label: '通义千问', base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen-plus', 'qwen-max', 'qwen-turbo'] },
  moonshot: { label: 'Moonshot', base: 'https://api.moonshot.cn/v1', models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'] },
  local: { label: '本地 Relay', base: 'http://127.0.0.1:4444/v1', models: ['deepseek-v4', 'glm-4.6', 'qwen3-coder'] },
  custom: { label: '自定义 · OpenAI 兼容', base: '', models: ['custom-model'] },
}

interface AgentForm {
  id: string
  name: string
  role: string
  desc: string
  provider: string
  base: string
  key: string
  model: string
  temp: number
  maxTok: string
  enabled: boolean
  tools: string[]
  skills: string[]
  kbs: string[]
  prompt: string
  tint: AgentRow['tint']
  initial: string
}

const forms = reactive<Record<string, AgentForm>>({
  terry: {
    id: 'terry', name: 'Terry', role: '日常任务助理', initial: 'T', tint: 'indigo',
    desc: '负责本地文件、Obsidian 与日程的默认执行者',
    provider: 'deepseek', base: 'https://api.deepseek.com/v1', key: 'sk-9f2c41ab7de04c8eb1f6a0d3',
    model: 'deepseek-chat', temp: 0.3, maxTok: '4096', enabled: true,
    tools: ['file_search', 'file_read', 'file_write', 'rag_query', 'obsidian_sync'],
    skills: ['prd-to-spec'], kbs: ['rag-notes', 'medical'],
    prompt: '你是 Terry，用户的日常任务助理。\n\n执行约定：\n1. 动笔前先确认方向，允许用一句话反问；\n2. 输出优先表格 / 列表，不要长段落铺陈；\n3. 涉及文件写入、删除、外部请求，先说明再执行；\n4. 回答里出现的事实要能从工具结果或知识库溯源。\n\n当前环境：{{workspace}} · 用户 {{user.name}} · 时间 {{now}}',
  },
  porter: {
    id: 'porter', name: 'Porter', role: '发布工程师', initial: 'P', tint: 'sky',
    desc: '中小企业应用发布，SSH + Docker 部署',
    provider: 'qwen', base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', key: 'sk-dash-7c1e09b4a2f38d51',
    model: 'qwen-plus', temp: 0.1, maxTok: '8192', enabled: true,
    tools: ['ssh_deploy', 'file_read', 'github_pr'],
    skills: ['excel-handler'], kbs: ['lingscape'],
    prompt: '你是 Porter，负责应用发布。\n\n硬约束：\n1. 生产环境操作前必须复述目标主机与版本号；\n2. 只走已登记发布窗口，窗口外挂起；\n3. 每一步都要能回滚。',
  },
  doc: {
    id: 'doc', name: 'DocWriter', role: '文档写手', initial: 'D', tint: 'teal',
    desc: '长文写作与知识库整理，偏好表格化输出',
    provider: 'local', base: 'http://127.0.0.1:4444/v1', key: 'relay-local-no-key',
    model: 'deepseek-v4', temp: 0.6, maxTok: '16384', enabled: true,
    tools: ['file_read', 'file_write', 'rag_query', 'obsidian_sync'],
    skills: ['prd-to-spec', 'wenwei'], kbs: ['rag-notes', 'medical'],
    prompt: '你是 DocWriter。默认输出表格与清单，不写长段落。\n涉及事实必须标注来源文件与段落。',
  },
  audit: {
    id: 'audit', name: 'Ksher Audit', role: '合规审计', initial: 'K', tint: 'clay',
    desc: '跨境支付 KYC / KYB 校验与台账导出',
    provider: 'anthropic', base: 'https://api.anthropic.com/v1', key: 'sk-ant-4e8b02ff19c7a6d3',
    model: 'claude-sonnet-4-5', temp: 0.0, maxTok: '8192', enabled: false,
    tools: ['file_read', 'rag_query'],
    skills: [], kbs: ['kyb'],
    prompt: '你是合规审计助手。结论要落到具体条款；\n证据不足时明说，不做推断。',
  },
  review: {
    id: 'review', name: 'CodeReview', role: '代码评审', initial: 'R', tint: 'violet',
    desc: 'Vue3 + TS 变更审查：类型、响应式、体积、可访问性',
    provider: 'openai', base: 'https://api.openai.com/v1', key: 'sk-proj-1b93de05c8f24a71',
    model: 'gpt-4.1', temp: 0.2, maxTok: '8192', enabled: true,
    tools: ['file_read', 'github_pr'],
    skills: ['frontend-code-review'], kbs: [],
    prompt: '你是资深前端评审。按 类型收敛 / 响应式陷阱 / 构建体积 / 可访问性 四类给意见，给出行号与改法。',
  },
})

const currentId = ref('terry')
const form = computed(() => forms[currentId.value])
const current = computed(() => agentList.find((a) => a.id === currentId.value)!)

const providerOptions = Object.entries(providers).map(([value, p]) => ({ value, label: p.label }))
const modelOptions = computed(() => (providers[form.value.provider]?.models ?? []).map((m) => ({ value: m, label: m })))

const allTools = ['file_search', 'file_read', 'file_write', 'rag_query', 'obsidian_sync', 'browser_open', 'github_pr', 'ssh_deploy']
const allSkills = ['prd-to-spec', 'extract-image-palette', 'wenwei-对齐', 'excel-handler']
const allKbs = [
  { v: 'rag-notes', label: 'RAG 工程笔记' },
  { v: 'medical', label: '医疗健康科普' },
  { v: 'lingscape', label: '灵境产品文档' },
]

function toggle(list: 'tools' | 'skills' | 'kbs', v: string) {
  const arr = form.value[list]
  const i = arr.indexOf(v)
  if (i > -1) arr.splice(i, 1)
  else arr.push(v)
}
function onProvider() {
  const p = providers[form.value.provider]
  if (p) {
    form.value.base = p.base
    form.value.model = p.models[0]
  }
}
const keyShown = ref(false)
const testLabel = ref('测试连接')
const confirmWrite = ref(true)
const sandboxExec = ref(true)
function test() {
  testLabel.value = '测试中…'
  setTimeout(() => {
    testLabel.value = '✓ 连通 · 128 ms'
    setTimeout(() => (testLabel.value = '测试连接'), 1800)
  }, 900)
}
const foot = ref('配置来自 DeepSeek · 与其他角色相互隔离')
function save() {
  const d = new Date()
  foot.value = `已保存 · 今天 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
function onSelect(a: AgentRow) {
  currentId.value = a.id
  setCrumbItem(`${a.name} · ${a.role}`)
}
onMounted(() => setCrumbItem('Terry · 日常任务助理'))
</script>

<template>
  <AgentListPane @select="onSelect" />

  <ViewShell :foot-note="foot">
    <template #identity>
      <Avatar :initial="form.initial" :tint="form.tint" size="lg" :dot="form.enabled ? 'thinking' : 'idle'" />
      <div>
        <div class="font-serif text-[22px] leading-[1.15] tracking-[0.2px] text-[var(--color-ink-1)]">
          {{ form.name }} · <em class="italic" style="color: var(--color-brand-deep)">{{ form.role }}</em>
        </div>
        <div class="mt-[3px] flex items-center gap-2">
          <Tag tone="brand" sm>{{ providers[form.provider]?.label }}</Tag>
          <Tag sm>{{ form.model }}</Tag>
          <Tag :tone="form.enabled ? 'ok' : 'default'" sm>{{ form.enabled ? '已启用' : '已停用' }}</Tag>
        </div>
      </div>
    </template>
    <template #actions>
      <ChipButton @click="test"><AppIcon name="activity" :size="13" /> {{ testLabel }}</ChipButton>
      <AppButton size="sm">复制</AppButton>
      <SwitchToggle v-model="form.enabled" label="启用该 Agent" />
    </template>

    <Card idx="1" title="身份" side="identity">
      <div class="grid grid-cols-2 gap-3.5">
        <Field label="名称"><TextInput v-model="form.name" /></Field>
        <Field label="定位"><TextInput v-model="form.role" /></Field>
      </div>
      <div class="mt-3.5">
        <Field label="简介（给群组和路由用）"><TextInput v-model="form.desc" /></Field>
      </div>
    </Card>

    <Card idx="2" title="模型与 API" side="每个 Agent 独立">
      <Field label="Provider">
        <SelectInput v-model="form.provider" :options="providerOptions" @update:model-value="onProvider" />
      </Field>
      <div class="mt-3.5">
        <Field label="Base URL"><TextInput v-model="form.base" mono /></Field>
      </div>
      <div class="mt-3.5">
        <Field label="API Key" hint="密钥按角色隔离存储，导出备份时会二次确认">
          <div class="flex gap-1.5">
            <TextInput v-model="form.key" mono :type="keyShown ? 'text' : 'password'" />
            <AppButton size="sm" @click="keyShown = !keyShown">{{ keyShown ? '隐藏' : '显示' }}</AppButton>
          </div>
        </Field>
      </div>
      <div class="mt-3.5 grid grid-cols-3 gap-3.5">
        <Field label="模型"><SelectInput v-model="form.model" :options="modelOptions" /></Field>
        <Field :label="`温度 ${form.temp.toFixed(2)}`">
          <input v-model.number="form.temp" type="range" min="0" max="1" step="0.05" class="mt-2 w-full" style="accent-color: var(--color-brand-solid)" />
        </Field>
        <Field label="最大输出 tokens"><TextInput v-model="form.maxTok" mono /></Field>
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
      <TextArea v-model="form.prompt" mono />
      <div class="mt-2 flex flex-wrap gap-1.5">
        <Tag sm v-pre>{{workspace}}</Tag>
        <Tag sm v-pre>{{user.name}}</Tag>
        <Tag sm v-pre>{{now}}</Tag>
      </div>
    </Card>

    <Card idx="5" title="护栏" side="guardrails">
      <KvRow k="写入前二次确认" sub="文件覆盖、批量删除、git 强推">
        <SwitchToggle v-model="confirmWrite" label="写入前二次确认" />
      </KvRow>
      <KvRow k="沙箱执行" sub="命令只允许在 workspace 目录内">
        <SwitchToggle v-model="sandboxExec" label="沙箱执行" />
      </KvRow>
      <KvRow k="单轮预算上限" sub="超过即停下并汇报，不继续烧钱" mono>¥ 1.50 / 轮</KvRow>
    </Card>

    <template #footer>
      <div class="flex gap-2">
        <AppButton>放弃更改</AppButton>
        <AppButton variant="primary" @click="save">保存角色</AppButton>
      </div>
    </template>
  </ViewShell>
</template>
