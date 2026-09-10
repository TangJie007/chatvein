import { z } from 'zod'
import { uniq } from 'es-toolkit'
import { truncate } from 'es-toolkit/compat'
import { HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages'
import type { LanguageModelLike } from '@langchain/core/language_models/base'
import type { StructuredToolInterface } from '@langchain/core/tools'
import {
  contentToString,
  extractJsonObject,
  withTimeoutSignal,
  type ChatMessage,
} from '../shared'

/**
 * 工具动态选用 agent —— 只做一件事：弱模判断「本轮需要哪些工具」。
 *
 * 给定候选工具全集（name + description）与用户消息，单次结构化输出挑出本轮
 * 真正要挂给主 agent 的工具名子集。不做 BM25 预筛 / token 预算裁剪——
 * 那是检索层与装配层的职责；这里纯粹是弱模的多选判断。
 *
 * 路径（与路由 L2 同套路）：
 *   1) `withStructuredOutput` 主路径（底层 = bindTools 的 function-calling，
 *      需要模型具备工具调用能力）；
 *   2) 模型无 function-calling / 结构化解析失败 → 普通 invoke + 从正文抽 JSON 兜底
 *      （只要能对话即可，prompt 强制只输出 JSON）；
 *   3) 超时 / 异常 / 解析失败 → 回退全部候选（宁多给工具，勿漏能力），永不抛错。
 */

/** 工具筛选输入 */
export interface ToolsFilterInput {
  /** 用户本轮消息 */
  message: string
  /** 可选历史（不含本轮），用于消解指代 */
  history?: ChatMessage[]
  /** 候选工具全集 */
  tools: StructuredToolInterface[]
  /** 外部取消信号 */
  signal?: AbortSignal
}

/** 结论来源（供埋点 / 调试） */
export type ToolsFilterVia = 'structured' | 'text' | 'passthrough_small' | 'fallback'

/** 工具筛选结果 */
export interface ToolsFilterResult {
  /** 本轮应挂载的工具子集（保持候选顺序） */
  tools: StructuredToolInterface[]
  /** 选中的工具名（按模型给出的相关度顺序） */
  toolIds: string[]
  /** 结论来源 */
  via: ToolsFilterVia
  /** 判定 / 兜底理由 */
  reason: string
}

/** 工具筛选 agent 句柄 */
export interface ToolsFilterAgent {
  /** 从候选工具中挑出本轮相关的工具子集 */
  filter(input: ToolsFilterInput): Promise<ToolsFilterResult>
}

/** createToolsFilterAgent 选项 */
export interface CreateToolsFilterAgentOptions {
  /** 工具判断用弱模型（优先 withStructuredOutput；不支持则纯文本 JSON 兜底） */
  model: LanguageModelLike
  /** Agent 名（trace / 多 Agent 区分） */
  name?: string
  /** 调用温度（默认 0） */
  temperature?: number
  /** 超时（ms），默认 10000；超时走兜底 */
  timeoutMs?: number
  /**
   * 候选数 ≤ 该值时直接全返、不调模型（默认 8）。
   * 工具集本身就很小时没必要花一次弱模调用。
   */
  passthroughK?: number
}

const ToolSelectJudgementSchema = z.object({
  toolIds: z.array(z.string()),
})
type ToolSelectJudgement = z.infer<typeof ToolSelectJudgementSchema>

const SYSTEM_PROMPT = `你是工具选用器，不是对话助手。根据用户本轮请求，从候选工具列表里选出完成该请求真正需要的工具。
输出唯一一个 JSON 对象。禁止 Markdown；禁止解释；禁止回答用户问题。

## 输出契约
{"toolIds":["工具名1","工具名2",...]}

规则：
1. toolIds 必须全部来自候选列表中的「工具名」（精确匹配，不得臆造）。
2. 只选本轮确实用得上的工具，按相关度从高到低排列；宁可少选，勿滥选。
3. 拿不准是否需要时，倾向于选上（漏工具会导致任务无法完成，多选只是略增开销）。
4. 纯寒暄 / 闲聊 / 无需任何工具即可回答时，返回空数组 {"toolIds":[]}。
5. 不要选择与请求无关的工具。`

/** 候选工具 → 编号列表文本（name — description） */
export function formatToolList(tools: readonly StructuredToolInterface[]): string {
  return tools
    .map(
      (t, i) =>
        `${i + 1}. ${t.name} — ${truncate(t.description ?? '(无描述)', { length: 160, omission: '…' })}`,
    )
    .join('\n')
}

function buildMessages(input: ToolsFilterInput): BaseMessage[] {
  const history = (input.history ?? [])
    .slice(-6)
    .map((m) => `[${m.role}] ${m.content}`)
    .join('\n')
  const human =
    (history ? `## 最近对话\n${history}\n\n` : '') +
    `## 用户本轮请求\n${input.message.slice(0, 2000)}\n\n` +
    `## 候选工具（name — description）\n${formatToolList(input.tools)}\n\n` +
    `请只输出 JSON：{"toolIds":[...]}`
  return [new SystemMessage(SYSTEM_PROMPT), new HumanMessage(human)]
}

function isFatal(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /timeout|abort|401|unauthorized|invalid.*key|ENOTFOUND|ECONNREFUSED/i.test(msg)
}

export function createToolsFilterAgent(options: CreateToolsFilterAgentOptions): ToolsFilterAgent {
  if (!options?.model) {
    throw new Error('createToolsFilterAgent: options.model is required')
  }
  const timeoutMs = options.timeoutMs ?? 10_000
  const passthroughK = options.passthroughK ?? 8

  return {
    async filter(input: ToolsFilterInput): Promise<ToolsFilterResult> {
      const tools = input.tools ?? []
      const allIds = tools.map((t) => t.name)

      // 空候选：直接返回空
      if (tools.length === 0) {
        return { tools: [], toolIds: [], via: 'passthrough_small', reason: '无候选工具' }
      }
      // 候选数已足够少：不调模型，全返
      if (tools.length <= passthroughK) {
        return {
          tools: [...tools],
          toolIds: allIds,
          via: 'passthrough_small',
          reason: `候选数 ${tools.length} ≤ ${passthroughK}，无需筛选`,
        }
      }

      const allowed = new Set(allIds)
      const byId = new Map(tools.map((t) => [t.name, t]))
      const messages = buildMessages(input)
      const callOptions = { signal: input.signal, temperature: options.temperature ?? 0 }

      const signal = withTimeoutSignal(timeoutMs, input.signal)
      try {
        // —— 主路径：结构化输出 ——
        const withStructured = (options.model as { withStructuredOutput?: unknown }).withStructuredOutput
        if (typeof withStructured === 'function') {
          try {
            const extractor = (
              withStructured as (
                schema: typeof ToolSelectJudgementSchema,
                opts?: { name: string },
              ) => { invoke: (m: BaseMessage[], o?: unknown) => Promise<unknown> }
            ).call(options.model, ToolSelectJudgementSchema, { name: 'select_tools' })
            const res = (await extractor.invoke(messages, { ...callOptions, signal })) as ToolSelectJudgement
            return resolveSelection(res?.toolIds, 'structured', byId, tools.length)
          } catch (err) {
            // 致命（超时/鉴权/网络）→ 直接兜底，不再浪费一次文本调用；
            // response_format 不支持 / 结构化解析失败 → 落到下面文本兜底
            if (isFatal(err)) throw err
          }
        }

        // —— 兜底：纯文本 JSON ——
        const res = await (
          options.model as { invoke: (m: BaseMessage[], o?: unknown) => Promise<{ content: unknown }> }
        ).invoke(messages, { ...callOptions, signal })
        const judgement = ToolSelectJudgementSchema.parse(
          extractJsonObject(contentToString(res.content)),
        )
        return resolveSelection(judgement.toolIds, 'text', byId, tools.length)
      } catch {
        // 超时 / 调用异常 / 解析失败 → 回退全部候选（宁多给勿漏）
        return {
          tools: [...tools],
          toolIds: allIds,
          via: 'fallback',
          reason: '弱模判断不可用或解析失败，回退全部候选',
        }
      }
    },
  }
}

/**
 * 把模型给出的工具名解析回工具对象：
 * - 过滤掉不在候选里的名字、去重；
 * - 空选（模型明确认为无需工具）→ 返回空集；
 * - 按模型相关度顺序返回工具对象。
 */
function resolveSelection(
  picked: unknown,
  via: ToolsFilterVia,
  byId: Map<string, StructuredToolInterface>,
  totalCount: number,
): ToolsFilterResult {
  const ids = Array.isArray(picked) ? picked.map((x) => String(x)).filter((id) => byId.has(id)) : []
  const deduped = uniq(ids)
  const selected = deduped.map((id) => byId.get(id)!).filter(Boolean)
  if (selected.length === 0) {
    // 模型明确返回空（纯寒暄等）或全是非法名 → 空集即结论
    return { tools: [], toolIds: [], via, reason: '弱模判断本轮无需工具' }
  }
  return {
    tools: selected,
    toolIds: deduped,
    via,
    reason: `弱模选中 ${selected.length}/${totalCount} 个工具`,
  }
}
