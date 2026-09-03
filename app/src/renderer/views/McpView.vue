<script setup lang="ts">
import { onMounted, ref } from 'vue'
import McpPane from './panes/McpPane.vue'
import ViewShell from '../components/layout/ViewShell.vue'
import Card from '../components/ui/Card.vue'
import KvRow from '../components/ui/KvRow.vue'
import AppButton from '../components/ui/AppButton.vue'
import SwitchToggle from '../components/ui/SwitchToggle.vue'
import Tag from '../components/ui/Tag.vue'
import Avatar from '../components/ui/Avatar.vue'
import { mcps } from '../data/lists'
import type { McpRow } from '../data/types'
import { setCrumbItem } from '../composables/useUi'

const enabled = ref(true)
const mcp = mcps[0]

const toolRows = [
  { name: 'read_file', desc: '读取单个文件，支持按行区间', agents: '3 个 Agent', on: true },
  { name: 'write_file', desc: '写入文件，触发写入护栏', agents: '2 个 Agent', on: true },
  { name: 'list_directory', desc: '列目录，默认限制深度 3', agents: '4 个 Agent', on: true },
  { name: 'search_files', desc: 'glob 模式匹配文件名', agents: '3 个 Agent', on: true },
  { name: 'move_file', desc: '移动 / 重命名，跨目录需确认', agents: '1 个 Agent', on: true },
  { name: 'delete_file', desc: '删除文件，始终二次确认', agents: '0 个 Agent', on: false },
]
const toolSwitch = ref<Record<string, boolean>>(
  Object.fromEntries(toolRows.map((t) => [t.name, t.on])),
)

const logLines = [
  { t: '14:02:11', k: 'connect', v: 'stdio transport established', dim: false },
  { t: '14:02:11', k: 'handshake', v: 'protocol 2025-06-18 · server filesystem v0.9.2', dim: false },
  { t: '14:02:11', k: 'tools', v: '6 tools discovered', dim: false },
  { t: '14:32:04', k: 'call', v: 'search_files("~/notes/2026-09-02-*rag*.md") → 180ms', dim: false },
  { t: '14:32:05', k: 'call', v: 'read_file("~/notes/2026-09-02-rag-notes.md") → 240ms', dim: false },
  { t: '14:33:41', k: 'call', v: 'move_file("rag-overview.md → Archive/2026-09/") → 90ms', dim: false },
  { t: '—', k: '', v: '监听中', dim: true },
]

function onSelect(m: McpRow) {
  setCrumbItem(m.name)
}
onMounted(() => setCrumbItem('filesystem'))
</script>

<template>
  <McpPane @select="onSelect" />

  <ViewShell foot-note="uptime 3h 12m · 今日调用 84 次">
    <template #identity>
      <Avatar :initial="mcp.initial" :tint="mcp.tint" size="lg" />
      <div>
        <div class="font-mono text-[22px] leading-[1.15] tracking-[0.2px] text-[var(--color-ink-1)]">{{ mcp.name }}</div>
        <div class="mt-[3px] flex flex-wrap items-center gap-2 text-xs text-[var(--color-ink-3)]">
          <Tag tone="ok" sm>已连接</Tag>
          <Tag sm>{{ mcp.transport }}</Tag>
          <span>{{ mcp.tools }} 个工具</span>
          <Tag tone="info" sm>{{ mcp.latency }}</Tag>
        </div>
      </div>
    </template>
    <template #actions>
      <AppButton size="sm">重启</AppButton>
      <AppButton size="sm">编辑</AppButton>
      <SwitchToggle v-model="enabled" label="启用 MCP 服务器" />
    </template>

    <Card title="连接" side="stdio · 子进程常驻">
      <div class="rounded-xl bg-[var(--color-track)] px-3.5 py-3 font-mono text-[11.5px] leading-[1.75] text-[var(--color-ink-2)]">
        <span class="text-[var(--color-ink-3)]">$</span>
        <span class="ml-2 text-[var(--color-brand-deep)]">npx</span>
        <span class="ml-1.5">-y @modelcontextprotocol/server-filesystem</span>
        <span class="ml-1.5 text-[var(--color-ok-ink)]">~/Workspace</span>
      </div>
      <div class="mt-3">
        <KvRow k="工作目录" mono>~/Workspace</KvRow>
        <KvRow k="协议版本" mono>2025-06-18</KvRow>
        <KvRow k="环境变量" mono>2 项已注入</KvRow>
      </div>
    </Card>

    <Card title="工具" side="6 个 · 勾选后对 Agent 可见">
      <div class="overflow-hidden rounded-[13px] bg-[var(--color-track)]">
        <table class="w-full border-collapse">
          <thead>
            <tr class="text-left text-[11px] font-semibold uppercase tracking-[0.3px] text-[var(--color-brand-dark)]">
              <th class="px-2.5 py-2">工具</th><th class="px-2.5 py-2">说明</th>
              <th class="w-[120px] px-2.5 py-2">授权给</th><th class="w-[56px] px-2.5 py-2">启用</th>
            </tr>
          </thead>
          <tbody class="text-[12.5px] text-[var(--color-ink-2)]">
            <tr v-for="t in toolRows" :key="t.name" class="shadow-[inset_0_1px_0_rgba(223,227,232,0.8)] hover:bg-[rgba(240,241,244,0.7)]">
              <td class="px-2.5 py-[9px] font-mono text-[11.5px]"><strong class="font-semibold text-[var(--color-ink-1)]">{{ t.name }}</strong></td>
              <td class="px-2.5 py-[9px]">{{ t.desc }}</td>
              <td class="px-2.5 py-[9px] font-mono text-[11.5px]">{{ t.agents }}</td>
              <td class="px-2.5 py-[9px]">
                <SwitchToggle :model-value="toolSwitch[t.name]" :label="t.name" @update:model-value="(v) => (toolSwitch[t.name] = v)" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>

    <Card title="运行日志" side="tail -f">
      <pre class="m-0 overflow-x-auto rounded-xl bg-[var(--color-track)] px-3.5 py-3 font-mono text-[11.5px] leading-[1.75] text-[var(--color-ink-2)]"><template v-for="(l, i) in logLines" :key="i"><span :class="l.dim ? 'italic text-[var(--color-ink-3)]' : 'text-[var(--color-ink-3)]'">{{ l.t }}</span>  <span v-if="l.k" class="text-[var(--color-brand-deep)]">{{ l.k }}</span>  <span :class="l.dim ? 'italic text-[var(--color-ink-3)]' : ''">{{ l.v }}</span>&#10;</template></pre>
    </Card>

    <template #footer>
      <div class="flex gap-2">
        <AppButton>断开连接</AppButton>
        <AppButton variant="primary">保存</AppButton>
      </div>
    </template>
  </ViewShell>
</template>
