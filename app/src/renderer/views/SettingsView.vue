<script setup lang="ts">
import { onMounted, ref } from 'vue'
import ViewShell from '../components/layout/ViewShell.vue'
import Card from '../components/ui/Card.vue'
import KvRow from '../components/ui/KvRow.vue'
import SwitchToggle from '../components/ui/SwitchToggle.vue'
import AppIcon from '../components/AppIcon.vue'
import { setCrumbItem } from '../composables/useUi'

const reduceMotion = ref(false)
const cmdAllowlist = ref(true)
const confirmWrites = ref(true)

onMounted(() => setCrumbItem('偏好设置'))
</script>

<template>
  <aside
    class="min-h-0"
    style="background: linear-gradient(180deg, rgb(251 251 252 / 0.9), rgb(235 237 240 / 0.88))"
  />

  <ViewShell foot-note="设置保存在本地 · 不随项目导出">
    <template #identity>
      <div class="grid h-[46px] w-[46px] place-items-center rounded-[14px] text-white shadow-[var(--shadow-brand)]" style="background: linear-gradient(135deg, var(--color-brand-lite), var(--color-brand-deep))">
        <AppIcon name="gear" :size="22" />
      </div>
      <div>
        <div class="font-serif text-[22px] leading-[1.15] tracking-[0.2px] text-[var(--color-ink-1)]">偏好设置</div>
        <div class="mt-[3px] text-xs text-[var(--color-ink-3)]">全局外观 · 沙箱 · 模型默认值</div>
      </div>
    </template>

    <Card idx="1" title="外观" side="appearance">
      <KvRow k="主题" sub="跟随系统 / 浅色 / 深色"><span class="font-mono text-xs">follow system</span></KvRow>
      <KvRow k="字体" mono>Geist · Instrument Serif · JetBrains Mono</KvRow>
      <KvRow k="减少动态效果"><SwitchToggle v-model="reduceMotion" label="reduce motion" /></KvRow>
    </Card>

    <Card idx="2" title="沙箱与护栏" side="sandbox">
      <KvRow k="默认沙箱提供方" sub="一期：独立工作区 + 受限 child_process"><span class="font-mono text-xs">local (P0)</span></KvRow>
      <KvRow k="命令白名单"><SwitchToggle v-model="cmdAllowlist" label="cmd allowlist" /></KvRow>
      <KvRow k="写入前二次确认"><SwitchToggle v-model="confirmWrites" label="confirm writes" /></KvRow>
      <KvRow k="单轮预算上限" mono>¥ 1.50 / 轮</KvRow>
    </Card>

    <Card idx="3" title="关于" side="forge">
      <KvRow k="产品" mono>Chatvein Forge</KvRow>
      <KvRow k="版本" mono>0.1.0</KvRow>
      <KvRow k="Harness" mono>@chatvein/* · Cordis runtime</KvRow>
    </Card>

    <template #footer>
      <div class="flex gap-2">
        <button class="rounded-[11px] border-0 bg-[var(--color-input)] px-[15px] py-[9px] text-[12.5px] font-semibold text-[var(--color-ink-2)]">恢复默认</button>
        <button class="rounded-[11px] border-0 px-[15px] py-[9px] text-[12.5px] font-semibold text-white shadow-[var(--shadow-brand)]" style="background: linear-gradient(180deg, var(--color-brand-lite), var(--color-brand-solid))">保存设置</button>
      </div>
    </template>
  </ViewShell>
</template>
