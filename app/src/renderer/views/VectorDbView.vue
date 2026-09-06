<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
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
const foot = ref('向量数据集（LanceDB）· 位于系统临时目录 chatvein-tool-index；启动后自动预建内置工具索引，MCP / 动态工具随对话增量收录')

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
      v-else-if="tables.length === 0 && !loadingTables"
      class="rounded-[10px] bg-[var(--color-canvas)] px-3 py-10 text-center text-xs text-[var(--color-ink-3)]"
    >
      索引尚未就绪。应用启动后会在后台自动预建内置工具索引（首次需下载本地嵌入模型，
      约数十 MB）；MCP 等动态工具随对话增量收录。完成后回到此页点击「刷新」即可像
      数据库客户端一样浏览表、结构与记录。若长时间为空，请查看主进程日志确认 warmup 是否成功。
    </div>

    <div v-else class="grid min-h-0 gap-4" style="grid-template-columns: 260px 1fr">
      <!-- 左：数据表清单 -->
      <Card title="数据表" :side="`${tables.length} 张`">
        <ul class="flex flex-col gap-1">
          <li v-for="t in tables" :key="t.name">
            <button
              type="button"
              class="flex w-full items-center justify-between gap-2 rounded-[10px] border border-transparent px-2.5 py-2 text-left transition-colors"
              :class="
                t.name === selected
                  ? 'border-[rgba(97,120,208,0.3)] bg-[var(--color-brand-mist)]'
                  : 'hover:bg-[var(--color-canvas)]'
              "
              @click="selectTable(t.name)"
            >
              <span class="truncate font-mono text-[12px] text-[var(--color-ink-1)]">{{ t.name }}</span>
              <span
                class="shrink-0 rounded-full bg-[var(--color-canvas)] px-2 py-0.5 font-mono text-[11px] text-[var(--color-ink-3)]"
                >{{ t.count }}</span
              >
            </button>
          </li>
        </ul>
      </Card>

      <!-- 右：结构 + 记录 -->
      <div class="flex min-w-0 flex-col gap-4">
        <Card title="结构" :side="selected ?? ''">
          <div v-if="columns.length" class="flex flex-wrap gap-x-5 gap-y-1.5 font-mono text-[12px]">
            <div v-for="c in columns" :key="c.name" class="flex items-center gap-1.5">
              <span class="text-[var(--color-ink-1)]">{{ c.name }}</span>
              <span class="rounded bg-[var(--color-canvas)] px-1.5 py-0.5 text-[11px] text-[var(--color-ink-3)]">{{
                c.type
              }}</span>
              <span v-if="c.name === 'vector'" class="text-[var(--color-brand-deep)]" title="向量列">⦿</span>
            </div>
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
            <table v-if="columns.length" class="w-full min-w-[640px] border-collapse text-left text-[12px]">
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
      </div>
    </div>
  </ViewShell>
</template>
