<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import ViewShell from '../components/layout/ViewShell.vue'
import Card from '../components/ui/Card.vue'
import KvRow from '../components/ui/KvRow.vue'
import Field from '../components/ui/Field.vue'
import TextInput from '../components/ui/TextInput.vue'
import SwitchToggle from '../components/ui/SwitchToggle.vue'
import AppButton from '../components/ui/AppButton.vue'
import AppIcon from '../components/AppIcon.vue'
import { setCrumbItem } from '../composables/useUi'
import { useSettings } from '../composables/useSettings'

const store = useSettings()

const form = reactive({
  workspaceRoot: '',
  runsRoot: '',
  cmdAllowlist: true,
  confirmWrites: true,
  reduceMotion: false,
})

const dirty = ref(false)
const saving = ref(false)
const foot = ref('路径建议放到非系统盘（如 D:），避免 C 盘被 runs / node_modules 占满')

const effectiveWorkspace = computed(
  () => store.settings?.effectiveWorkspaceRoot || form.workspaceRoot || '未设置',
)
const effectiveRuns = computed(
  () => store.settings?.effectiveRunsRoot || form.runsRoot || '未设置',
)

function markDirty() {
  dirty.value = true
}

function loadForm() {
  const s = store.settings
  if (!s) return
  form.workspaceRoot = s.workspaceRoot
  form.runsRoot = s.runsRoot
  form.cmdAllowlist = s.cmdAllowlist
  form.confirmWrites = s.confirmWrites
  form.reduceMotion = s.reduceMotion
  dirty.value = false
}

async function pickWorkspace() {
  const path = await store.pickFolder({
    title: '选择工作区根目录',
    defaultPath: form.workspaceRoot || store.settings?.defaultWorkspaceRoot,
  })
  if (path) {
    form.workspaceRoot = path
    markDirty()
  }
}

async function pickRuns() {
  const path = await store.pickFolder({
    title: '选择沙箱运行根目录',
    defaultPath: form.runsRoot || store.settings?.defaultRunsRoot,
  })
  if (path) {
    form.runsRoot = path
    markDirty()
  }
}

async function save() {
  if (saving.value) return
  saving.value = true
  try {
    await store.update({
      workspaceRoot: form.workspaceRoot.trim(),
      runsRoot: form.runsRoot.trim(),
      cmdAllowlist: form.cmdAllowlist,
      confirmWrites: form.confirmWrites,
      reduceMotion: form.reduceMotion,
    })
    loadForm()
    const d = new Date()
    foot.value = `已保存 · ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch (e) {
    foot.value = `保存失败：${(e as Error).message}`
  } finally {
    saving.value = false
  }
}

async function reset() {
  if (!window.confirm('恢复默认路径与护栏？将改回「文档/Chatvein」下的默认目录。')) return
  await store.reset()
  loadForm()
  foot.value = '已恢复默认'
}

onMounted(async () => {
  setCrumbItem('偏好设置')
  if (!store.loaded) await store.refresh()
  loadForm()
})
</script>

<template>
  <aside
    class="min-h-0"
    style="background: linear-gradient(180deg, rgb(251 251 252 / 0.9), rgb(235 237 240 / 0.88))"
  />

  <ViewShell :foot-note="foot">
    <template #identity>
      <div
        class="grid h-[46px] w-[46px] place-items-center rounded-[14px] text-white shadow-[var(--shadow-brand)]"
        style="background: linear-gradient(135deg, var(--color-brand-lite), var(--color-brand-deep))"
      >
        <AppIcon name="gear" :size="22" />
      </div>
      <div>
        <div class="font-serif text-[22px] leading-[1.15] tracking-[0.2px] text-[var(--color-ink-1)]">偏好设置</div>
        <div class="mt-[3px] text-xs text-[var(--color-ink-3)]">工作区路径 · 沙箱运行目录 · 护栏</div>
      </div>
    </template>

    <Card idx="1" title="存储位置" side="避免占满 C 盘">
      <Field label="工作区根目录" hint="用户项目 / 日常工作文件的默认落点；建议选 D: 或大容量盘">
        <div class="flex gap-1.5">
          <TextInput v-model="form.workspaceRoot" mono placeholder="D:\Chatvein\workspaces" @update:model-value="markDirty" />
          <AppButton size="sm" @click="pickWorkspace">
            <AppIcon name="folder" :size="13" /> 浏览
          </AppButton>
        </div>
      </Field>
      <p class="mt-1.5 font-mono text-[11px] text-[var(--color-ink-3)]">有效路径：{{ effectiveWorkspace }}</p>

      <div class="mt-3.5">
        <Field label="沙箱运行根目录" hint="runs/&lt;run_id&gt;/workspace 建在此下；含依赖安装，最吃磁盘">
          <div class="flex gap-1.5">
            <TextInput v-model="form.runsRoot" mono placeholder="D:\Chatvein\runs" @update:model-value="markDirty" />
            <AppButton size="sm" @click="pickRuns">
              <AppIcon name="folder" :size="13" /> 浏览
            </AppButton>
          </div>
        </Field>
        <p class="mt-1.5 font-mono text-[11px] text-[var(--color-ink-3)]">有效路径：{{ effectiveRuns }}</p>
      </div>
    </Card>

    <Card idx="2" title="沙箱与护栏" side="sandbox">
      <KvRow k="默认沙箱提供方" sub="一期：独立工作区 + 受限 child_process">
        <span class="font-mono text-xs">local (P0)</span>
      </KvRow>
      <KvRow k="命令白名单">
        <SwitchToggle
          :model-value="form.cmdAllowlist"
          label="cmd allowlist"
          @update:model-value="(v: boolean) => { form.cmdAllowlist = v; markDirty() }"
        />
      </KvRow>
      <KvRow k="写入前二次确认">
        <SwitchToggle
          :model-value="form.confirmWrites"
          label="confirm writes"
          @update:model-value="(v: boolean) => { form.confirmWrites = v; markDirty() }"
        />
      </KvRow>
      <KvRow k="单轮预算上限" mono>¥ 1.50 / 轮</KvRow>
    </Card>

    <Card idx="3" title="外观" side="appearance">
      <KvRow k="主题" sub="跟随系统 / 浅色 / 深色"><span class="font-mono text-xs">follow system</span></KvRow>
      <KvRow k="字体" mono>Geist · Instrument Serif · JetBrains Mono</KvRow>
      <KvRow k="减少动态效果">
        <SwitchToggle
          :model-value="form.reduceMotion"
          label="reduce motion"
          @update:model-value="(v: boolean) => { form.reduceMotion = v; markDirty() }"
        />
      </KvRow>
    </Card>

    <Card idx="4" title="关于" side="forge">
      <KvRow k="产品" mono>Chatvein Forge</KvRow>
      <KvRow k="版本" mono>0.1.0</KvRow>
      <KvRow k="Harness" mono>@chatvein/* · Cordis runtime</KvRow>
    </Card>

    <template #footer>
      <div class="flex gap-2">
        <AppButton @click="reset">恢复默认</AppButton>
        <AppButton variant="primary" :disabled="saving" @click="save">
          {{ saving ? '保存中…' : dirty ? '保存设置' : '已保存' }}
        </AppButton>
      </div>
    </template>
  </ViewShell>
</template>
