/**
 * C2 工具精筛 prompt：LangChain `ChatPromptTemplate`。
 * C2：优先 `withStructuredOutput`；遇 response_format 不支持等 → 纯文本 JSON 兜底
 * （`select-prompt.ts` ChatPromptTemplate，与路由 L2 同套路）。
 */
import { ChatPromptTemplate } from '@langchain/core/prompts'
import type { BaseMessage } from '@langchain/core/messages'
import { truncateFolded } from '@chatvein/context'

export interface ToolSelectListItem {
  name: string
  description?: unknown
}

export const TOOL_SELECT_SYSTEM_PROMPT = `你是 Chatvein 的工具选用器，不是对话助手。
根据用户请求，从候选工具列表中选出本轮最相关的工具。
输出唯一一个 JSON 对象。禁止 Markdown；禁止解释；禁止回答用户问题。

## 输出契约
{{"toolIds":["工具名1","工具名2",...]}}

规则：
1. toolIds 必须全部来自候选列表中的「工具名」（精确匹配）
2. 至多选出 {maxK} 个；宁可少选，勿滥选
3. 按相关度从高到低排列
4. 若几乎都不相关，仍选最可能有用的 1～3 个，不要返回空数组`

const TOOL_SELECT_USER_TEMPLATE = `## 用户请求
{query}

## 候选工具（name — description）
{toolList}

请只输出 JSON：{{"toolIds":[...]}}（至多 {maxK} 个）。`

/** C2 ChatPromptTemplate：`{maxK}` / `{query}` / `{toolList}` */
export const toolSelectChatPromptTemplate = ChatPromptTemplate.fromMessages([
  ['system', TOOL_SELECT_SYSTEM_PROMPT],
  ['human', TOOL_SELECT_USER_TEMPLATE],
])

export type ToolSelectPromptVars = {
  query: string
  toolList: string
  maxK: string
}

function toolDescriptionText(description: unknown): string {
  if (typeof description === 'string') return description
  if (description == null) return ''
  try {
    return JSON.stringify(description)
  } catch {
    return String(description)
  }
}

/** 候选 → 编号列表文本（描述强制成字符串，避免 `[object Object]`） */
export function formatToolSelectList(candidates: readonly ToolSelectListItem[]): string {
  return candidates
    .map((c, i) => {
      const desc = truncateFolded(toolDescriptionText(c.description), 120).text
      return `${i + 1}. ${c.name} — ${desc || '(无描述)'}`
    })
    .join('\n')
}

export function buildToolSelectPromptVars(
  query: string,
  candidates: readonly ToolSelectListItem[],
  maxK: number,
): ToolSelectPromptVars {
  return {
    query: query.slice(0, 2000),
    toolList: formatToolSelectList(candidates),
    maxK: String(maxK),
  }
}

/** 格式化为 LangChain messages（C2 唯一 prompt 出口） */
export function formatToolSelectPromptMessages(
  query: string,
  candidates: readonly ToolSelectListItem[],
  maxK: number,
): Promise<BaseMessage[]> {
  return toolSelectChatPromptTemplate.formatMessages(
    buildToolSelectPromptVars(query, candidates, maxK),
  )
}
