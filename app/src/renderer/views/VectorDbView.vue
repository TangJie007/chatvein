<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
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

const modeOptions = [
  { value: 'browse', label: '浏览' },
  { value: 'vector', label: '向量匹配' },
  { value: 'hybrid', label: '向量+BM25加权' },
] as const

/** 记录卡查看方式：browse = 分页浏览；vector = 纯向量匹配；hybrid = 向量+BM25 加权（对齐对话工具预筛 C1） */
const mode = ref<'browse' | 'vector' | 'hybrid'>('browse')
/** 语义查询输入（向量匹配 / 混合加权共用） */
const vecQuery = ref('')
/**
 * 相似度阈值：
 * - vector：过滤全部命中；
 * - hybrid：只作用于向量路（与 C1 一致），工具名/别名 BM25 命中不受阈值截断。
 */
const vecMin = ref('0.2')
const searching = ref(false)
const vecRan = ref(false)
const vecError = ref('')

/** 语义命中统一展示行：向量模式走 vectorScore；混合模式走两路分 + 融合分 */
interface HitRow {
  id: string
  content: string
  summary: string | null
  scope: string
  ownerId: string
  kind: string
  meta: Record<string, unknown>
  vectorScore: number | null
  bm25Score: number | null
  fusedScore: number | null
  sources: Array<'vector' | 'bm25'>
}
const hits = ref<HitRow[]>([])

/** 当前库中仅 tool_index 含向量列，可语义匹配 */
const canVector = computed(() => selected.value === 'tool_index')
const vecMinNum = computed(() => {
  const n = Number.parseFloat(vecMin.value)
  return Number.isFinite(n) ? n : 0.2
})
const bm25HitCount = computed(() => hits.value.filter((h) => h.bm25Score != null).length)
const semanticSummaryText = computed(() => {
  const threshold = vecMinNum.value.toFixed(2)
  const totalRows = selectedInfo.value?.count ?? 0
  if (mode.value === 'hybrid') {
    if (!vecRan.value) return '向量+BM25加权 · 名/别名 BM25 与向量 RRF 融合'
    const bm25 = bm25HitCount.value
    return `加权融合：${hits.value.length} / ${totalRows}（BM25 ${bm25} · 纯向量 ${hits.value.length - bm25}）`
  }
  if (!vecRan.value) return `向量匹配 · 阈值 ≥ ${threshold}`
  return `符合 ≥ ${threshold}：${hits.value.length} / ${totalRows}`
})

function scoreTone(s: number): { cls: string; label: string } {
  if (s >= 0.65) return { cls: 'bg-[var(--color-brand-deep)] text-white', label: '高' }
  if (s >= 0.45) return { cls: 'bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]', label: '中' }
  if (s >= 0.2) return { cls: 'bg-[var(--color-canvas)] text-[var(--color-ink-3)]', label: '低' }
  return { cls: 'bg-transparent text-[var(--color-ink-3)]', label: '极低' }
}

/** 按当前模式执行语义检索：vector → 纯向量；hybrid → 向量 + BM25 加权（RRF） */
async function runSearch() {
  const q = vecQuery.value.trim()
  if (!q || !selected.value || !canVector.value || mode.value === 'browse') return
  searching.value = true
  vecRan.value = true
  vecError.value = ''
  try {
    if (mode.value === 'hybrid') {
      const hs = await api.vector.hybridSearchTable(selected.value, {
        query: q,
        minScore: vecMinNum.value,
      })
      hits.value = hs.map((h) => ({
        id: h.id,
        content: h.content,
        summary: h.summary,
        scope: h.scope,
        ownerId: h.ownerId,
        kind: h.kind,
        meta: h.meta,
        vectorScore: h.vectorScore,
        bm25Score: h.bm25Score,
        fusedScore: h.fusedScore,
        sources: h.sources,
      }))
    } else {
      const vs = await api.vector.searchTable(selected.value, {
        query: q,
        minScore: vecMinNum.value,
      })
      hits.value = vs.map((h) => ({
        id: h.id,
        content: h.content,
        summary: h.summary,
        scope: h.scope,
        ownerId: h.ownerId,
        kind: h.kind,
        meta: h.meta,
        vectorScore: h.score,
        bm25Score: null,
        fusedScore: null,
        sources: ['vector'],
      }))
    }
  } catch (e) {
    hits.value = []
    vecError.value = `查询失败：${(e as Error)?.message ?? String(e)}。首次查询需加载本地嵌入模型 bge-small-zh，请联网后重试（权重缓存于 userData/forge/hf-cache）。`
  } finally {
    searching.value = false
  }
}

/** 在「向量匹配 / 向量+BM25加权」间切换时清掉上一模式结果，避免跨模式残留展示 */
watch(mode, () => {
  if (mode.value === 'browse') return
  hits.value = []
  vecRan.value = false
  vecError.value = ''
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
  if (name !== 'tool_index') mode.value = 'browse'
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

      <Card title="记录" :side="mode === 'browse' ? rangeText : semanticSummaryText">
        <div class="mb-3 flex flex-wrap items-center gap-2">
          <!-- 查看方式切换 -->
          <div class="inline-flex gap-0.5 rounded-[10px] bg-[var(--color-input)] p-[3px]">
            <button
              v-for="opt in modeOptions"
              :key="opt.value"
              type="button"
              class="rounded-[7px] border-0 px-3 py-1.5 text-xs font-medium transition-colors duration-200 ease-[var(--ease-soft)] focus-visible:outline-2 focus-visible:outline-[var(--color-brand)] focus-visible:outline-offset-1"
              :class="
                mode === opt.value
                  ? 'bg-[var(--color-elevated)] text-[var(--color-ink-1)] shadow-[0_1px_3px_rgb(43_44_48/0.08)]'
                  : 'text-[var(--color-ink-2)]'
              "
              @click="mode = opt.value"
            >
              {{ opt.label }}
            </button>
          </div>

          <!-- 浏览模式：关键字过滤 + 翻页 -->
          <div v-if="mode === 'browse'" class="flex min-w-0 flex-1 items-center gap-2">
            <div class="min-w-0 flex-1">
              <TextInput v-model="keyword" mono placeholder="在当前页按任意字段过滤" />
            </div>
            <div class="flex shrink-0 items-center gap-1">
              <AppButton size="sm" :disabled="!canPrev" @click="prevPage">上一页</AppButton>
              <AppButton size="sm" :disabled="!canNext" @click="nextPage">下一页</AppButton>
            </div>
          </div>

          <!-- 向量匹配模式：自然语言查询 + 分数阈值 + Top-K -->
          <div v-else-if="mode === 'vector'" class="flex min-w-[320px] flex-1 flex-wrap items-center gap-2">
            <div class="min-w-[180px] flex-1">
              <TextInput
                v-model="vecQuery"
                mono
                placeholder="自然语言查询：如 把结果保存为 md 文件"
                @keydown.enter="runSearch"
              />
            </div>
            <label class="flex shrink-0 items-center gap-1 text-[11px] text-[var(--color-ink-3)]">
              分数 ≥
              <input
                v-model="vecMin"
                type="number"
                min="0"
                max="1"
                step="0.05"
                title="余弦相似度下限：score 低于该值的命中不展示"
                class="w-14 rounded-[8px] border-0 bg-[var(--color-input)] px-1.5 py-[7px] font-mono text-xs text-[var(--color-ink-1)] focus:outline-none"
              />
            </label>
            <AppButton
              size="sm"
              variant="primary"
              :disabled="searching || !canVector || !vecQuery.trim()"
              @click="runSearch"
            >
              {{ searching ? '检索中…' : '查询' }}
            </AppButton>
          </div>

          <!-- 向量+BM25 加权：工具名/别名 BM25 与向量 RRF 融合（对齐对话工具预筛 C1） -->
          <div v-else class="flex min-w-[360px] flex-1 flex-wrap items-center gap-2">
            <div class="min-w-[200px] flex-1">
              <TextInput
                v-model="vecQuery"
                mono
                placeholder="自然语言或工具名/别名：如 保存为 md / read_text_file"
                @keydown.enter="runSearch"
              />
            </div>
            <label class="flex shrink-0 items-center gap-1 text-[11px] text-[var(--color-ink-3)]">
              向量分 ≥
              <input
                v-model="vecMin"
                type="number"
                min="0"
                max="1"
                step="0.05"
                title="只过滤向量路相似度下限；工具名/别名 BM25 命中即使向量分低仍会进入融合"
                class="w-14 rounded-[8px] border-0 bg-[var(--color-input)] px-1.5 py-[7px] font-mono text-xs text-[var(--color-ink-1)] focus:outline-none"
              />
            </label>
            <AppButton
              size="sm"
              variant="primary"
              :disabled="searching || !canVector || !vecQuery.trim()"
              @click="runSearch"
            >
              {{ searching ? '检索中…' : '查询' }}
            </AppButton>
          </div>
        </div>

        <!-- ============ 浏览模式内容 ============ -->
        <div v-if="mode === 'browse'" class="scroll-thin overflow-auto" style="max-height: calc(100vh - 380px)">
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

        <!-- ============ 语义匹配（向量 / 向量+BM25加权）内容 ============ -->
        <div v-else>
          <div class="scroll-thin overflow-auto" style="max-height: calc(100vh - 380px)">
            <div
              v-if="!canVector"
              class="mb-2 rounded-[10px] bg-[var(--color-canvas)] px-3 py-2 text-xs leading-[1.6] text-[var(--color-ink-3)]"
            >
              {{ mode === 'hybrid' ? '向量+BM25 加权' : '语义匹配' }}需该表含向量列。当前库中仅
              <code class="font-mono">tool_index</code> 可语义检索，其余表请切回「浏览」。
            </div>

            <div
              v-else-if="searching && hits.length === 0"
              class="py-10 text-center text-xs text-[var(--color-ink-3)]"
            >
              正在{{ mode === 'hybrid' ? '重建 BM25 词法索引并' : '' }}向量检索（首次需加载本地嵌入模型
              bge-small-zh）…
            </div>
            <div
              v-else-if="vecError"
              class="rounded-[10px] bg-[rgba(220,80,80,0.08)] px-3 py-2 text-xs leading-[1.7] text-[var(--color-ink-2)]"
            >
              {{ vecError }}
            </div>

            <template v-else-if="vecRan">
              <!-- 汇总：纯向量 = 符合阈值 N/M；混合 = 加权融合命中 N/M（含两路分） -->
              <div
                class="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-[10px] bg-[var(--color-canvas)] px-3 py-2 text-xs leading-[1.7] text-[var(--color-ink-3)]"
              >
                <template v-if="mode === 'vector'">
                  <span>得分 ≥</span>
                  <span class="font-mono font-semibold text-[var(--color-brand-deep)]">{{ vecMinNum.toFixed(2) }}</span>
                  <span>的有</span>
                  <span class="font-mono font-semibold text-[var(--color-ink-1)]">{{ hits.length }}</span>
                  <span>条</span>
                </template>
                <template v-else>
                  <span class="font-mono font-semibold text-[var(--color-brand-deep)]">{{ hits.length }}</span>
                  <span>条加权融合命中，其中 BM25</span>
                  <span class="font-mono font-semibold text-[var(--color-ink-1)]">{{ bm25HitCount }}</span>
                  <span>条、纯向量 {{ hits.length - bm25HitCount }} 条</span>
                </template>
                <span class="text-[var(--color-ink-3)]">·</span>
                <span>
                  共 {{ selectedInfo?.count ?? 0 }} 条记录（{{
                    mode === 'hybrid' ? '按 RRF 融合权重降序' : '按相似度从高到低'
                  }}）
                </span>
              </div>

              <table v-if="hits.length" class="w-full min-w-[760px] border-collapse text-left text-[12px]">
                <thead>
                  <tr class="sticky top-0 bg-[var(--color-elevated)] text-[var(--color-ink-3)]">
                    <th class="w-[130px] px-2 py-2 font-medium">
                      {{ mode === 'hybrid' ? '融合 / 两路分' : '得分' }}
                    </th>
                    <th class="w-[180px] px-2 py-2 font-medium">id</th>
                    <th class="px-2 py-2 font-medium">命中内容 / 摘要</th>
                    <th class="w-[170px] px-2 py-2 font-medium">来源 / 范围 / kind</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="(h, idx) in hits"
                    :key="h.id"
                    class="border-t border-[rgba(165,177,193,0.18)] align-top hover:bg-[var(--color-canvas)]"
                  >
                    <td class="px-2 py-2">
                      <!-- 纯向量：余弦相似度色阶 -->
                      <template v-if="mode === 'vector'">
                        <span class="inline-flex items-center gap-1.5">
                          <span
                            class="rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold"
                            :class="scoreTone(h.vectorScore ?? 0).cls"
                            :title="`${scoreTone(h.vectorScore ?? 0).label}相关`"
                            >{{ scoreTone(h.vectorScore ?? 0).label }}</span
                          >
                          <span class="font-mono text-[var(--color-ink-2)]">{{
                            (h.vectorScore ?? 0).toFixed(3)
                          }}</span>
                        </span>
                      </template>
                      <!-- 混合：RRF 融合权重 + 向量/BM25 两路分 -->
                      <template v-else>
                        <div class="flex items-baseline gap-1.5">
                          <span class="font-mono text-[13px] font-semibold text-[var(--color-ink-1)]">{{
                            (h.fusedScore ?? 0).toFixed(4)
                          }}</span>
                          <span class="text-[10px] text-[var(--color-ink-3)]">#{{ idx + 1 }}</span>
                        </div>
                        <div class="mt-1 flex flex-wrap gap-1">
                          <span
                            class="rounded px-1.5 py-0.5 font-mono text-[10.5px] leading-[1.3]"
                            :class="
                              h.vectorScore != null
                                ? 'bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]'
                                : 'bg-[var(--color-canvas)] text-[var(--color-ink-3)]'
                            "
                            title="向量路余弦相似度（BM25 命中不受阈值截断）"
                            >向量 {{ h.vectorScore != null ? h.vectorScore.toFixed(2) : '—' }}</span
                          >
                          <span
                            class="rounded px-1.5 py-0.5 font-mono text-[10.5px] leading-[1.3]"
                            :class="
                              h.bm25Score != null
                                ? 'bg-[rgba(180,83,9,0.12)] text-[#b45309]'
                                : 'bg-[var(--color-canvas)] text-[var(--color-ink-3)]'
                            "
                            title="工具名 / 人类名 / 目录别名 / title 的 BM25 词法得分"
                            >BM25 {{ h.bm25Score != null ? h.bm25Score.toFixed(2) : '—' }}</span
                          >
                        </div>
                      </template>
                    </td>
                    <td class="px-2 py-2">
                      <span class="break-all font-mono text-[11px] text-[var(--color-brand-deep)]">{{ h.id }}</span>
                    </td>
                    <td class="px-2 py-2">
                      <div
                        class="line-clamp-3 max-w-[540px] leading-[1.55] text-[var(--color-ink-1)]"
                        :title="h.content"
                      >
                        {{ h.content }}
                      </div>
                      <div v-if="h.summary" class="mt-0.5 text-[11px] text-[var(--color-ink-3)]">{{ h.summary }}</div>
                      <details v-if="Object.keys(h.meta ?? {}).length" class="mt-1">
                        <summary class="cursor-pointer select-none text-[11px] text-[var(--color-brand-deep)]">meta</summary>
                        <pre class="mt-1 whitespace-pre-wrap break-all text-[11px] text-[var(--color-ink-2)]">{{
                          JSON.stringify(h.meta, null, 1)
                        }}</pre>
                      </details>
                    </td>
                    <td class="px-2 py-2">
                      <div class="flex flex-wrap gap-1">
                        <template v-if="mode === 'hybrid'">
                          <span
                            v-for="src in h.sources"
                            :key="src"
                            class="rounded px-1.5 py-0.5 text-[11px]"
                            :class="
                              src === 'bm25'
                                ? 'bg-[rgba(180,83,9,0.12)] text-[#b45309]'
                                : 'bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]'
                            "
                            >{{ src === 'bm25' ? 'BM25' : '向量' }}</span
                          >
                        </template>
                        <span class="rounded bg-[var(--color-canvas)] px-1.5 py-0.5 text-[11px] text-[var(--color-ink-3)]">{{
                          h.scope
                        }}</span>
                        <span class="rounded bg-[var(--color-canvas)] px-1.5 py-0.5 text-[11px] text-[var(--color-ink-3)]">{{
                          h.kind
                        }}</span>
                        <span
                          v-if="h.ownerId"
                          class="rounded bg-[var(--color-canvas)] px-1.5 py-0.5 text-[11px] text-[var(--color-ink-3)]"
                          >{{ h.ownerId }}</span
                        >
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
              <div
                v-else
                class="rounded-[10px] bg-[var(--color-canvas)] px-3 py-10 text-center text-xs leading-[1.8] text-[var(--color-ink-3)]"
              >
                <template v-if="mode === 'vector'">
                  0 条达到阈值。向量分数是连续值，极少“零命中”：可把意图写完整
                  （如「把结果保存为 md 文件」），或调低阈值至 0.1 观察分数分布。
                </template>
                <template v-else>
                  0 条命中：既无 ≥ 阈值的向量命中，也无工具名/别名 BM25 命中（RRF 融合需任一路有召回）。
                  可尝试更贴近工具名/别名的词（如 read_text_file、保存、下载）。
                </template>
              </div>
            </template>

            <div v-else class="py-10 text-center text-xs leading-[1.8] text-[var(--color-ink-3)]">
              <template v-if="mode === 'vector'">
                输入一句自然语言描述后点「查询」或直接回车，返回该表全部得分 ≥ 阈值（默认 0.2）的记录。
              </template>
              <template v-else>
                输入自然语言或工具名/别名后点「查询」：向量余弦与工具名/别名 BM25 经 RRF 加权融合后排序；
                「向量分 ≥」只过滤向量路，名称/别名精确命中的工具会显著上浮（与对话工具预筛 C1 一致）。
              </template>
            </div>
          </div>
        </div>
      </Card>
    </template>
  </ViewShell>
</template>
