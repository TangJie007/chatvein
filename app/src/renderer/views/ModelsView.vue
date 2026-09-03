<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import ModelListPane from './panes/ModelListPane.vue'
import ViewShell from '../components/layout/ViewShell.vue'
import Card from '../components/ui/Card.vue'
import Field from '../components/ui/Field.vue'
import TextInput from '../components/ui/TextInput.vue'
import SelectInput from '../components/ui/SelectInput.vue'
import AppButton from '../components/ui/AppButton.vue'
import Tag from '../components/ui/Tag.vue'
import AppIcon from '../components/AppIcon.vue'
import SwitchToggle from '../components/ui/SwitchToggle.vue'
import { useModels } from '../composables/useModels'
import type { ModelConfig, ModelInput } from '../ipc-api'
import { setCrumbItem } from '../composables/useUi'

const store = useModels()

const currentId = ref('')
const form = reactive<ModelForm>(emptyForm())

interface ModelForm {
  id: string
  name: string
  provider: string
  baseUrl: string
  apiKey: string
  model: string
  temperature: number
  maxTokens: number
  enabled: boolean
}

function emptyForm(): ModelForm {
  return {
    id: '',
    name: '',
    provider: 'custom',
    baseUrl: '',
    apiKey: '',
    model: '',
    temperature: 0.3,
    maxTokens: 0,
    enabled: true,
  }
}

const current = computed(() => store.models.find((m) => m.id === currentId.value))

const providerOptions = computed(() =>
  store.presets.map((p) => ({ value: p.value, label: p.label })),
)
const presetModels = computed(
  () => store.presets.find((p) => p.value === form.provider)?.models ?? [],
)
const providerLabel = computed(
  () => store.presets.find((p) => p.value === form.provider)?.label ?? form.provider,
)

const MAX_TOKEN_OPTIONS = [
  { value: '0', label: '自动（由模型决定）' },
  { value: '1024', label: '1,024' },
  { value: '2048', label: '2,048' },
  { value: '4096', label: '4,096' },
  { value: '8192', label: '8,192' },
  { value: '16384', label: '16,384' },
]

const maxTokensValue = computed({
  get: () => {
    const n = form.maxTokens
    if (!n || n <= 0) return '0'
    return String(Math.min(n, 16384))
  },
  set: (v: string) => {
    const n = Number(v)
    form.maxTokens = !n || n <= 0 ? 0 : Math.min(n, 16384)
    markDirty()
  },
})

const maxTokenOptions = MAX_TOKEN_OPTIONS

const keyShown = ref(false)
const testing = ref(false)
const testLabel = ref('测试连接')
const saving = ref(false)
const foot = ref('API Key 本地加密存储 · Agent 创建时可直接选用')
const dirty = ref(false)

function markDirty() {
  dirty.value = true
}

function loadIntoForm(m: ModelConfig) {
  Object.assign(form, {
    id: m.id,
    name: m.name,
    provider: m.provider,
    baseUrl: m.baseUrl,
    apiKey: m.apiKey,
    model: m.model,
    temperature: m.temperature,
    maxTokens: m.maxTokens,
    enabled: m.enabled,
  })
  dirty.value = false
}

function onSelect(m: ModelConfig) {
  currentId.value = m.id
  loadIntoForm(m)
  setCrumbItem(`${m.name} · ${store.presetLabel(m.provider)}`)
}

function onProvider() {
  const p = store.presets.find((x) => x.value === form.provider)
  if (p) {
    if (p.baseUrl) form.baseUrl = p.baseUrl
    if (p.models.length && !p.models.includes(form.model)) {
      form.model = p.models[0]
      if (!form.name || form.name.startsWith('新模型')) form.name = p.models[0]
    }
  }
  markDirty()
}

async function test() {
  if (testing.value) return
  testing.value = true
  testLabel.value = '测试中…'
  try {
    const r = await store.testConnection({
      baseUrl: form.baseUrl,
      apiKey: form.apiKey,
      model: form.model,
    })
    testLabel.value = r.ok ? `✓ 连通 · ${r.latencyMs} ms` : `✕ ${r.message}`
  } catch (e) {
    testLabel.value = `✕ ${(e as Error).message}`
  } finally {
    testing.value = false
    setTimeout(() => (testLabel.value = '测试连接'), 2600)
  }
}

function collectPatch(): ModelInput {
  return {
    name: form.name.trim() || form.model || '未命名模型',
    provider: form.provider,
    baseUrl: form.baseUrl,
    apiKey: form.apiKey,
    model: form.model,
    temperature: form.temperature,
    maxTokens: form.maxTokens <= 0 ? 0 : Math.min(form.maxTokens, 16384),
    enabled: form.enabled,
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

async function createModel() {
  const created = await store.create({ name: `新模型 ${store.models.length + 1}`, provider: 'deepseek' })
  currentId.value = created.id
  loadIntoForm(created)
  setCrumbItem(`${created.name} · ${store.presetLabel(created.provider)}`)
  dirty.value = true
}

async function removeModel() {
  if (!form.id) return
  if (!window.confirm(`删除模型「${form.name}」？`)) return
  try {
    await store.remove(form.id)
    const next = store.models[0]
    if (next) onSelect(next)
    else {
      currentId.value = ''
      Object.assign(form, emptyForm())
      setCrumbItem('')
    }
  } catch (e) {
    const msg = (e as Error).message || '删除失败'
    foot.value = msg
    window.alert(msg)
  }
}

onMounted(async () => {
  if (!store.loaded) await store.refresh()
  const first = store.models[0]
  if (first) {
    currentId.value = first.id
    loadIntoForm(first)
    setCrumbItem(`${first.name} · ${store.presetLabel(first.provider)}`)
  }
})
</script>

<template>
  <ModelListPane
    :models="store.models"
    :model-value="currentId"
    :loading="store.loading"
    :preset-label="store.presetLabel"
    @select="onSelect"
    @add="createModel"
  />

  <ViewShell :foot-note="foot">
    <template #identity>
      <div
        class="grid h-12 w-12 place-items-center rounded-[16px] text-[var(--color-brand-deep)]"
        style="background: linear-gradient(180deg, var(--color-brand-mist), rgb(233 236 249 / 0.55))"
      >
        <AppIcon name="cpu" :size="22" />
      </div>
      <div>
        <div class="font-serif text-[22px] leading-[1.15] tracking-[0.2px] text-[var(--color-ink-1)]">
          {{ form.name || '未命名模型' }}
        </div>
        <div class="mt-[3px] flex items-center gap-2">
          <Tag tone="brand" sm>{{ providerLabel }}</Tag>
          <Tag sm class="font-mono">{{ form.model || '未配置' }}</Tag>
          <Tag :tone="form.enabled ? 'ok' : 'default'" sm>{{ form.enabled ? '已启用' : '已停用' }}</Tag>
        </div>
      </div>
    </template>
    <template #actions>
      <AppButton size="sm" :disabled="testing || !form.id" @click="test">
        <AppIcon name="activity" :size="13" /> {{ testLabel }}
      </AppButton>
      <AppButton v-if="form.id" size="sm" variant="ghost" @click="removeModel">删除</AppButton>
      <SwitchToggle
        :model-value="form.enabled"
        label="启用该模型"
        :disabled="!form.id"
        @update:model-value="(v: boolean) => { form.enabled = v; markDirty() }"
      />
    </template>

    <template v-if="form.id">
      <Card idx="1" title="基本信息" side="display">
        <Field label="显示名称" hint="Agent 选型列表中展示">
          <TextInput v-model="form.name" placeholder="如 DeepSeek Chat" @update:model-value="markDirty" />
        </Field>
      </Card>

      <Card idx="2" title="连接配置" side="OpenAI 兼容 · 一期">
        <Field label="Provider">
          <SelectInput v-model="form.provider" :options="providerOptions" @update:model-value="onProvider" />
        </Field>
        <div class="mt-3.5">
          <Field label="Base URL" hint="OpenAI 兼容端点，以 /v1 结尾">
            <TextInput v-model="form.baseUrl" mono placeholder="https://api.deepseek.com/v1" @update:model-value="markDirty" />
          </Field>
        </div>
        <div class="mt-3.5">
          <Field label="API Key" hint="落盘经系统加密（Windows DPAPI）；不入 trace">
            <div class="flex gap-1.5">
              <TextInput
                v-model="form.apiKey"
                mono
                :type="keyShown ? 'text' : 'password'"
                placeholder="sk-..."
                @update:model-value="markDirty"
              />
              <AppButton size="sm" @click="keyShown = !keyShown">{{ keyShown ? '隐藏' : '显示' }}</AppButton>
            </div>
          </Field>
        </div>
        <div class="mt-3.5">
          <Field label="模型 ID" hint="可从建议选或直接填网关侧模型名">
            <TextInput
              v-model="form.model"
              mono
              list="model-id-suggestions"
              placeholder="deepseek-chat"
              @update:model-value="markDirty"
            />
            <datalist id="model-id-suggestions">
              <option v-for="m in presetModels" :key="m" :value="m" />
            </datalist>
          </Field>
        </div>
      </Card>

      <Card idx="3" title="采样参数" side="默认值 · Agent 直接沿用">
        <div class="grid grid-cols-2 gap-3.5">
          <Field :label="`温度 ${form.temperature.toFixed(2)}`">
            <input
              v-model.number="form.temperature"
              type="range"
              min="0"
              max="1"
              step="0.05"
              class="mt-2 w-full"
              style="accent-color: var(--color-brand-solid)"
              @input="markDirty"
            />
          </Field>
          <Field label="最大输出 tokens" hint="自动 = 不传上限，由网关/模型默认；固定值用于防止过长烧钱">
            <SelectInput v-model="maxTokensValue" :options="maxTokenOptions" />
          </Field>
        </div>
      </Card>
    </template>

    <div v-else class="px-1 py-16 text-center text-sm text-[var(--color-ink-3)]">
      点击左侧「+」添加第一个模型
    </div>

    <template #footer>
      <div class="flex items-center gap-2">
        <AppButton :disabled="!form.id" @click="discard">放弃更改</AppButton>
        <AppButton variant="primary" :disabled="!form.id || saving" @click="save">
          {{ saving ? '保存中…' : dirty ? '保存模型' : '已保存' }}
        </AppButton>
      </div>
    </template>
  </ViewShell>
</template>
