<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import VectorDbPane from './panes/VectorDbPane.vue'
import ViewShell from '../components/layout/ViewShell.vue'
import Card from '../components/ui/Card.vue'
import TextInput from '../components/ui/TextInput.vue'
import AppButton from '../components/ui/AppButton.vue'
import AppIcon from '../components/AppIcon.vue'
import { setCrumbItem } from '../composables/useUi'
import { createClient } from '@electrum/client'
import type { IpcApi, VectorBrowseResult, VectorTableInfo } from '../ipc-api'

const api = createClient<IpcApi>()

const tables = ref<VectorTableInfo[]>([])
const selected = ref<string | null>(null)
const rows = ref<Record<string, unknown>[]>([])
const total = ref(0)
const limit = ref(50)
const offset = ref(0)
const keyword = ref('')
const loadingTables = ref(false)
const loadingRows = ref(false)
const error = ref('')
const foot = ref('向量数据集（LanceDB）· userData/forge/vector；启动预建内置工具索引，MCP 变更经 refreshToolIndex 差量收录（对话不写库）')

interface VectorCell {
  __vector: true
  dimensions: number
}

function isVectorCell(v: unknown): v is VectorCell {
  return !!v && typeof v === 'object' && '__vector' in v
}
function isObjectCell(v: unknown): boolean {
  return !!v && typeof v === 'object' && !isVectorCell(v)
}
function fmtTime(v: unknown): string {
  const n = typeof v === 'bigint' ? Number(v) : typeof v === 'number' ? v : 0
  if (!n) return '—'
  const d = new Date(n)
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
function cellText(_col: string, v: unknown): string {
  if (v == null) return ''
  if (isVectorCell(v)) return `⦿ dim ${v.dimensions}`
  if (typeof v === 'bigint') return String(v)
  if (typeof v === 'number') return String(v)
  if (typeof v === 'string') return v
  return JSON.stringify(v)
}

/** 把 arrow / lance 的底层类型字符串转成易读的短类型名 */
function fmtType(t: string): string {
  const vecMatch = t.match(/FixedSizeList<([^>]+)>/)
  if (vecMatch) return `${vecMatch[1]?.toLowerCase() ?? 'float32'} 向量数组`
  const map: Record<string, string> = {
    Utf8: 'string',
    LargeUtf8: 'string',
    Int8: 'int8',
    Int16: 'int16',
    Int32: 'int32',
    Int64: 'int64',
    UInt8: 'uint8',
    UInt16: 'uint16',
    UInt32: 'uint32',
    UInt64: 'uint64',
    Float16: 'float16',
    Float32: 'float32',
    Float64: 'float64',
    Bool: 'bool',
    Binary: 'binary',
    Timestamp: 'timestamp',
    Date: 'date',
    Json: 'json',
  }
  const base = t.replace(/\(.*/, '').replace(/\[.*/, '')
  return map[base] ?? t
}
function isVecType(t: string): boolean {
  return /FixedSizeList|List<.*Float|<Float/.test(t)
}
function isTimeType(t: string): boolean {
  return /^Timestamp|^Date/.test(t)
}

/** 按列名（辅以类型）解释字段含义；工具索引等本机数据集使用固定 schema */
const COLUMN_HINTS: Record<string, string> = {
  id: '记录主键（写入方指定，或由内容哈希派生），用于去重与覆盖更新',
  vector: '语义向量（float32 数组）。检索时与查询向量按余弦距离比较，越近越相关',
  content: '实际入库的文本。工具检索场景下为「工具名 + 描述 + 入参 schema」的摘要',
  summary: '简短摘要或别名，可为空',
  scope: '记录归属范围（如 global），可参与检索过滤',
  owner_id: '归属对象标识：工具、会话等写入方名称',
  kind: '记录类别：如 tool_desc（工具描述）/ doc / memory 等',
  meta_json: '附加元数据（JSON 字符串），浏览记录时以 meta 折叠展示',
  embedding_model: '生成该行向量所用的本地嵌入模型',
  created_at: '首次收录时间（毫秒时间戳）',
  updated_at: '最近一次更新时间（毫秒时间戳）',
}
function describeCol(name: string, type: string): string {
  if (COLUMN_HINTS[name]) return COLUMN_HINTS[name]!
  if (isVecType(type)) return '向量列：内容经嵌入模型转为等长 float32 数组'
  if (isTimeType(type)) return '时间字段，浏览时已格式化为本地时间'
  return '该表自定义字段，含义以实际写入内容为准'
}

const selectedInfo = computed(() => tables.value.find((t) => t.name === selected.value) ?? null)
const columns = computed(() => selectedInfo.value?.columns ?? [])
const canPrev = computed(() => offset.value > 0)
const canNext = computed(() => offset.value + limit.value < total.value)
const rangeText = computed(() => {
  if (total.value === 0) return '0 行'
  const from = offset.value + 1
  const to = Math.min(offset.value + limit.value, total.value)
  return `第 ${from}–${to} 行 / 共 ${total.value} 行`
})
const visibleRows = computed(() => {
  const k = keyword.value.trim().toLowerCase()
  if (!k) return rows.value
  return rows.value.filter((r) => Object.values(r).some((v) => cellText('', v).toLowerCase().includes(k)))
})

async function loadTables() {
  loadingTables.value = true
  error.value = ''
  try {
    const list = await api.vector.inspectTables()
    tables.value = list
    if (selected.value && !list.some((t) => t.name === selected.value)) selected.value = null
    if (!selected.value && list.length) {
      selected.value = list.find((t) => t.name === 'tool_index')?.name ?? list[0]!.name
    }
    if (selected.value) await loadRows()
  } catch (e) {
    error.value = (e as Error)?.message ?? String(e)
  } finally {
    loadingTables.value = false
  }
}

async function loadRows() {
  if (!selected.value) return
  loadingRows.value = true
  try {
    const res: VectorBrowseResult = await api.vector.browseTable(selected.value, limit.value, offset.value)
    rows.value = res.rows
    total.value = res.total
  } catch (e) {
    error.value = (e as Error)?.message ?? String(e)
  } finally {
    loadingRows.value = false
  }
}

function selectTable(name: string) {
  if (name === selected.value) return
  selected.value = name
  offset.value = 0
  void loadRows()
}
function prevPage() {
  if (!canPrev.value) return
  offset.value = Math.max(0, offset.value - limit.value)
  void loadRows()
}
function nextPage() {
  if (!canNext.value) return
  offset.value = offset.value + limit.value
  void loadRows()
}
async function refresh() {
  await loadTables()
}

onMounted(async () => {
  setCrumbItem('向量数据库')
  await loadTables()
})
</script>

<template>
  <VectorDbPane
    :tables="tables"
    :selected="selected"
    :loading="loadingTables"
    @select="selectTable"
  />

  <ViewShell :foot-note="foot">
    <template #identity>
      <div
        class="grid h-[46px] w-[46px] place-items-center rounded-[14px] text-white shadow-[var(--shadow-brand)]"
        style="background: linear-gradient(135deg, var(--color-brand-lite), var(--color-brand-deep))"
      >
        <AppIcon name="vector" :size="22" />
      </div>
      <div>
        <div class="font-serif text-[22px] leading-[1.15] tracking-[0.2px] text-[var(--color-ink-1)]">
          向量数据库
        </div>
        <div class="mt-[3px] text-xs text-[var(--color-ink-3)]">数据集浏览器 · 表 / 结构 / 记录</div>
      </div>
    </template>

    <template #actions>
      <AppButton size="sm" :disabled="loadingTables || loadingRows" @click="refresh">
        <AppIcon name="restart" :size="13" /> 刷新
      </AppButton>
    </template>

    <div
      v-if="error"
      class="rounded-[10px] bg-[rgba(220,80,80,0.08)] px-3 py-2 text-xs text-[var(--color-ink-2)]"
    >
      读取失败：{{ error }}
    </div>

    <div
      v-else-if="loadingTables && tables.length === 0"
      class="rounded-[10px] bg-[var(--color-canvas)] px-3 py-10 text-center text-xs text-[var(--color-ink-3)]"
    >
      正在连接向量数据集…
    </div>

    <div
      v-else-if="tables.length === 0"
      class="rounded-[10px] bg-[var(--color-canvas)] px-3 py-10 text-center text-xs text-[var(--color-ink-3)]"
    >
      索引尚未就绪。应用启动后会在后台自动预建内置工具索引（首次需下载本地嵌入模型，
      约数十 MB）；MCP 等在配置变更时差量收录（对话回合不写库）。完成后回到此页点击「刷新」即可像
      数据库客户端一样浏览表、结构与记录。若长时间为空，请查看主进程日志确认 warmup 是否成功。
    </div>

    <template v-else>
      <Card title="结构" :side="selected ?? ''">
        <div v-if="columns.length" class="scroll-thin overflow-auto">
          <table class="w-full min-w-[560px] border-collapse text-left text-[12px]">
            <thead>
              <tr
                class="sticky top-0 border-b border-[rgba(165,177,193,0.25)] text-[11px] font-semibold uppercase tracking-[0.3px] text-[var(--color-ink-3)]"
                style="background: var(--color-elevated)"
              >
                <th class="w-[150px] px-2 py-2">列名</th>
                <th class="w-[180px] px-2 py-2">类型</th>
                <th class="px-2 py-2">说明</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="c in columns"
                :key="c.name"
                class="border-b border-[rgba(165,177,193,0.14)] align-top last:border-0 hover:bg-[var(--color-canvas)]"
              >
                <td class="px-2 py-2">
                  <span class="font-mono font-medium text-[var(--color-ink-1)]">{{ c.name }}</span>
                  <span v-if="c.name === 'vector' || isVecType(c.type)" class="ml-1" title="向量列">⦿</span>
                </td>
                <td class="px-2 py-2">
                  <span
                    class="rounded bg-[var(--color-canvas)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--color-ink-3)]"
                    >{{ fmtType(c.type) }}</span
                  >
                </td>
                <td class="px-2 py-2 leading-[1.55] text-[var(--color-ink-2)]">{{ describeCol(c.name, c.type) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="text-xs text-[var(--color-ink-3)]">请选择左侧数据表</div>
      </Card>

      <Card title="记录" :side="rangeText">
        <div class="mb-3 flex items-center gap-2">
          <TextInput v-model="keyword" mono placeholder="在当前页按任意字段过滤" class="w-full" />
          <div class="flex shrink-0 items-center gap-1">
            <AppButton size="sm" :disabled="!canPrev" @click="prevPage">上一页</AppButton>
            <AppButton size="sm" :disabled="!canNext" @click="nextPage">下一页</AppButton>
          </div>
        </div>

        <div class="scroll-thin overflow-auto" style="max-height: calc(100vh - 380px)">
          <div
            v-if="loadingRows && rows.length === 0"
            class="py-10 text-center text-xs text-[var(--color-ink-3)]"
          >
            读取记录…
          </div>

          <table v-else-if="columns.length" class="w-full min-w-[640px] border-collapse text-left text-[12px]">
            <thead>
              <tr class="sticky top-0 bg-[var(--color-elevated)] text-[var(--color-ink-3)]">
                <th v-for="c in columns" :key="c.name" class="px-2 py-2 font-medium">{{ c.name }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(r, i) in visibleRows"
                :key="i"
                class="border-t border-[rgba(165,177,193,0.18)] hover:bg-[var(--color-canvas)]"
              >
                <td v-for="c in columns" :key="c.name" class="px-2 py-2 align-top">
                  <template v-if="c.name === 'vector' && isVectorCell(r[c.name])">
                    <span
                      class="rounded bg-[var(--color-brand-soft)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--color-brand-deep)]"
                      >⦿ dim {{ (r[c.name] as VectorCell).dimensions }}</span
                    >
                  </template>
                  <template v-else-if="isObjectCell(r[c.name])">
                    <details class="max-w-[360px]">
                      <summary class="cursor-pointer select-none text-[var(--color-brand-deep)]">meta</summary>
                      <pre class="mt-1 whitespace-pre-wrap break-all text-[11px] text-[var(--color-ink-2)]">{{
                        cellText(c.name, r[c.name])
                      }}</pre>
                    </details>
                  </template>
                  <template v-else-if="c.name === 'created_at' || c.name === 'updated_at'">
                    <span class="font-mono text-[var(--color-ink-3)]">{{ fmtTime(r[c.name]) }}</span>
                  </template>
                  <template v-else>
                    <span
                      class="line-clamp-3 block max-w-[420px] font-mono text-[var(--color-ink-2)]"
                      :title="cellText(c.name, r[c.name])"
                      >{{ cellText(c.name, r[c.name]) }}</span
                    >
                  </template>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-else class="text-xs text-[var(--color-ink-3)]">请选择左侧数据表</div>
        </div>
      </Card>
    </template>
  </ViewShell>
</template>
