<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
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

const store = useAgents()
const models = useModels()

const currentId = ref('')
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
  systemPrompt: string
  // 以下字段一期只回显落盘值，能力绑定 UI 暂不改写
  tools: string[]
  skills: string[]
  kbs: string[]
}

const TINTS: AvatarTint[] = ['indigo', 'sky', 'peach', 'clay', 'rose', 'slate', 'teal', 'violet']

const tintSwatch: Record<AvatarTint, string> = {
  indigo: 'bg-[linear-gradient(135deg,#8496D8,#5A6FCB)]',
  sky: 'bg-[linear-gradient(135deg,#B7DCE8,#7FB3C9)]',
  peach: 'bg-[linear-gradient(135deg,#E9C5B1,#D29880)]',
  clay: 'bg-[linear-gradient(135deg,#D6A985,#B57E58)]',
  rose: 'bg-[linear-gradient(135deg,#FB8E9B,#E44E60)]',
  slate: 'bg-[linear-gradient(135deg,#BCC6D3,#8E9AA9)]',
  teal: 'bg-[linear-gradient(135deg,#A1CEC8,#6FAE9F)]',
  violet: 'bg-[linear-gradient(135deg,#C3B9E8,#8E7FCB)]',
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
    systemPrompt: '',
    tools: [],
    skills: [],
    kbs: [],
  }
}

const current = computed(() => store.agents.find((a) => a.id === currentId.value))

const modelOptions = computed(() => {
  const enabled = models.models.filter((m) => m.enabled)
  const opts = enabled.map((m) => ({
    value: m.id,
    label: `${m.name} · ${m.model}`,
  }))
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
  return selectedModel.value?.name ?? '模型缺失'
})

/**
 * 能力绑定一期占位：假数据仅用于 UI 展示，不接真实 MCP / Skills / 知识库源。
 * 后续接入后再替换为接口列表，并允许改写 form.tools / skills / kbs。
 */
const PLACEHOLDER_TOOLS = ['file_search', 'file_read', 'file_write', 'rag_query', 'obsidian_sync', 'browser_open', 'github_pr', 'ssh_deploy']
const PLACEHOLDER_SKILLS = ['prd-to-spec', 'extract-image-palette', 'wenwei-对齐', 'excel-handler']
const PLACEHOLDER_KBS = [
  { v: 'rag-notes', label: 'RAG 工程笔记' },
  { v: 'medical', label: '医疗健康科普' },
  { v: 'lingscape', label: '灵境产品文档' },
]

const saving = ref(false)
const foot = ref('可编辑：身份 · 模型 · 系统提示词 · 启停')
const dirty = ref(false)
const initialManual = ref(false)

function markDirty() {
  dirty.value = true
}

function onNameInput(v: string) {
  form.name = v
  if (!initialManual.value) {
    const ch = v.trim()[0]
    if (ch) form.initial = ch.toUpperCase()
  }
  markDirty()
}

function onInitialInput(v: string) {
  form.initial = (v || '').slice(0, 2)
  initialManual.value = true
  markDirty()
}

function setTint(t: AvatarTint) {
  form.tint = t
  markDirty()
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
    systemPrompt: a.systemPrompt,
    tools: [...a.tools],
    skills: [...a.skills],
    kbs: [...a.knowledgeBases],
  })
  initialManual.value = true
  dirty.value = false
}

function onSelect(a: AgentConfig) {
  currentId.value = a.id
  loadIntoForm(a)
  setCrumbItem(a.isMain ? `主对话 · ${a.name}` : `${a.name} · ${a.role}`)
}

function modelLabelFor(agent: AgentConfig): string {
  if (!agent.modelId) return '未选模型'
  return models.findById(agent.modelId)?.name ?? '模型缺失'
}

function collectPatch(): AgentInput {
  return {
    name: form.name.trim(),
    role: form.role.trim() || '自定义角色',
    desc: form.desc.trim(),
    initial: (form.initial || form.name.trim()[0] || 'A').slice(0, 2),
    tint: form.tint,
    modelId: form.modelId,
    enabled: form.isMain ? true : form.enabled,
    systemPrompt: form.systemPrompt,
    // 能力绑定一期不改写：拷贝为纯数组再过 IPC（Vue Proxy 无法 structured clone）
    tools: [...form.tools],
    skills: [...form.skills],
    knowledgeBases: [...form.kbs],
  }
}

function validate(): string | null {
  if (!form.name.trim()) return '请填写 Agent 名称'
  if (!form.modelId) return '请选择模型（在「模型选型」中添加后可在此选用）'
  if (form.modelId && !models.findById(form.modelId)) return '所选模型不存在或已删除，请重新选择'
  return null
}

async function save() {
  if (!form.id || saving.value) return
  const err = validate()
  if (err) {
    foot.value = err
    return
  }
  saving.value = true
  try {
    const updated = await store.update(form.id, collectPatch())
    loadIntoForm(updated)
    setCrumbItem(updated.isMain ? `主对话 · ${updated.name}` : `${updated.name} · ${updated.role}`)
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
  foot.value = '已放弃更改'
}

async function createAgent() {
  const defaultModelId = models.models.find((m) => m.enabled)?.id ?? ''
  const created = await store.create({
    name: `新 Agent ${store.agents.length + 1}`,
    modelId: defaultModelId,
    role: '自定义角色',
  })
  currentId.value = created.id
  loadIntoForm(created)
  initialManual.value = false
  setCrumbItem(`${created.name} · ${created.role}`)
  dirty.value = true
  foot.value = defaultModelId ? '已创建，可继续完善身份与提示词' : '已创建 · 请先到「模型选型」添加模型再绑定'
}

async function removeAgent() {
  if (!form.id || form.isMain) return
  if (!window.confirm(`删除角色「${form.name}」？该操作不可撤销。`)) return
  try {
    await store.remove(form.id)
    const next = store.agents.find((a) => a.isMain) ?? store.agents[0]
    if (next) onSelect(next)
    foot.value = '已删除'
  } catch (e) {
    foot.value = `删除失败：${(e as Error).message}`
    window.alert((e as Error).message)
  }
}

watch(
  () => form.name,
  (name) => {
    if (current.value) {
      setCrumbItem(form.isMain ? `主对话 · ${name || '未命名'}` : `${name || '未命名'} · ${form.role}`)
    }
  },
)

onMounted(async () => {
  await Promise.all([
    store.loaded ? Promise.resolve() : store.refresh(),
    models.loaded ? Promise.resolve() : models.refresh(),
  ])
  const main = store.agents.find((a) => a.isMain) ?? store.agents[0]
  if (main) onSelect(main)
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
      <Avatar :initial="form.initial || 'A'" :tint="form.tint" size="lg" :dot="form.enabled ? 'thinking' : 'idle'" />
      <div>
        <div class="font-serif text-[22px] leading-[1.15] tracking-[0.2px] text-[var(--color-ink-1)]">
          {{ form.name || '未命名' }} ·
          <em class="italic" style="color: var(--color-brand-deep)">{{ form.role || '未设置定位' }}</em>
        </div>
        <div class="mt-[3px] flex flex-wrap items-center gap-2">
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

    <!-- 身份：一期完整可编辑 -->
    <Card idx="1" title="身份" side="identity">
      <div class="grid grid-cols-2 gap-3.5">
        <Field label="名称">
          <TextInput
            :model-value="form.name"
            placeholder="如 Terry"
            @update:model-value="onNameInput"
          />
        </Field>
        <Field label="定位">
          <TextInput v-model="form.role" placeholder="如 日常任务助理" @update:model-value="markDirty" />
        </Field>
      </div>
      <div class="mt-3.5">
        <Field label="简介（给群组和路由用）">
          <TextInput v-model="form.desc" placeholder="一句话说明专长与适用场景" @update:model-value="markDirty" />
        </Field>
      </div>
      <div class="mt-3.5 grid grid-cols-[100px_1fr] gap-3.5">
        <Field label="头像字">
          <TextInput
            :model-value="form.initial"
            mono
            placeholder="T"
            @update:model-value="onInitialInput"
          />
        </Field>
        <Field label="头像配色">
          <div class="flex flex-wrap gap-1.5 pt-0.5">
            <button
              v-for="t in TINTS"
              :key="t"
              type="button"
              class="h-7 w-7 rounded-full border-0 shadow-[inset_0_0_0_1px_rgba(43,44,48,0.08)] transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-[var(--color-brand)] focus-visible:outline-offset-2"
              :class="[
                tintSwatch[t],
                form.tint === t ? 'ring-2 ring-[var(--color-brand-solid)] ring-offset-2' : '',
              ]"
              :aria-label="t"
              :aria-pressed="form.tint === t"
              @click="setTint(t)"
            ></button>
          </div>
        </Field>
      </div>
    </Card>

    <!-- 模型：从模型选型绑定 -->
    <Card idx="2" title="模型" side="从模型选型中选用">
      <Field label="选用模型" hint="连接与 Key 在「模型选型」中统一配置；保存前必须选择">
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
          <div class="mt-0.5 font-mono">{{ selectedModel.maxTokens > 0 ? selectedModel.maxTokens : '自动' }}</div>
        </div>
      </div>
      <div class="mt-3 text-xs text-[var(--color-ink-3)]">
        没有合适的模型？
        <RouterLink to="/models" class="text-[var(--color-brand-deep)] underline-offset-2 hover:underline">去模型选型添加</RouterLink>
      </div>
    </Card>

    <!--
      能力绑定：一期仅占位展示，不接真实 MCP / Skills / 知识库，交互禁用。
      后续接入数据源后再开放改写，并参与 Agent 运行时权限过滤。
    -->
    <Card idx="3" title="能力绑定" side="一期占位 · 暂不生效">
      <div class="mb-3 flex items-center gap-2">
        <Tag tone="warn" sm>暂未接入</Tag>
        <span class="text-[11.5px] text-[var(--color-ink-3)]">工具 / Skills / 知识库将在后续版本绑定真实数据源</span>
      </div>
      <Field label="工具（来自 MCP 与内置）">
        <div class="pointer-events-none flex flex-wrap gap-1.5 opacity-55">
          <ChipPick
            v-for="t in PLACEHOLDER_TOOLS"
            :key="t"
            :model-value="form.tools.includes(t)"
            :value="t"
          >{{ t }}</ChipPick>
        </div>
      </Field>
      <div class="mt-3.5 grid grid-cols-2 gap-3.5">
        <Field label="Skills">
          <div class="pointer-events-none flex flex-wrap gap-1.5 opacity-55">
            <ChipPick
              v-for="s in PLACEHOLDER_SKILLS"
              :key="s"
              :model-value="form.skills.includes(s)"
              :value="s"
            >{{ s }}</ChipPick>
          </div>
        </Field>
        <Field label="知识库">
          <div class="pointer-events-none flex flex-wrap gap-1.5 opacity-55">
            <ChipPick
              v-for="k in PLACEHOLDER_KBS"
              :key="k.v"
              :model-value="form.kbs.includes(k.v)"
              :value="k.v"
            >{{ k.label }}</ChipPick>
          </div>
        </Field>
      </div>
    </Card>

    <!-- 系统提示词：一期完整可编辑 -->
    <Card idx="4" title="系统提示词" side="支持变量占位">
      <TextArea
        v-model="form.systemPrompt"
        mono
        placeholder="定义角色人设、输出格式与行为约束…"
        @update:model-value="markDirty"
      />
      <div class="mt-2 flex flex-wrap gap-1.5">
        <Tag sm v-pre>{{workspace}}</Tag>
        <Tag sm v-pre>{{user.name}}</Tag>
        <Tag sm v-pre>{{now}}</Tag>
      </div>
    </Card>

    <!--
      护栏：一期仅占位，实际开关在「设置 → 沙箱与护栏」全局配置。
      角色级护栏（预算、确认策略等）后续再做，此处不读写。
    -->
    <Card idx="5" title="护栏" side="一期占位 · 见全局设置">
      <div class="mb-2 flex items-center gap-2">
        <Tag tone="warn" sm>暂未接入</Tag>
        <span class="text-[11.5px] text-[var(--color-ink-3)]">角色级护栏后续开放；当前以全局设置为准</span>
      </div>
      <KvRow k="写入前二次确认" sub="文件覆盖、批量删除、git 强推">
        <span class="font-mono text-xs text-[var(--color-ink-3)]">全局设置</span>
      </KvRow>
      <KvRow k="沙箱执行" sub="命令只允许在工作区 / 运行根目录内">
        <span class="font-mono text-xs text-[var(--color-ink-3)]">全局设置</span>
      </KvRow>
      <KvRow k="单轮预算上限" sub="超过即停下并汇报，不继续烧钱" mono>¥ 1.50 / 轮</KvRow>
    </Card>

    <template #footer>
      <div class="flex items-center gap-2">
        <AppButton :disabled="!form.id || !dirty" @click="discard">放弃更改</AppButton>
        <AppButton variant="primary" :disabled="!form.id || saving" @click="save">
          {{ saving ? '保存中…' : dirty ? '保存角色' : '已保存' }}
        </AppButton>
      </div>
    </template>
  </ViewShell>
</template>
