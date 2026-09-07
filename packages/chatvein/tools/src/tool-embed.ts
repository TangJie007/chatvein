/**
 * 统一「工具 → 嵌入文本」：工具向量索引的唯一文本来源。
 *
 * 纯函数、零外部依赖（不引入 `@chatvein/vector`），因此 sidecar / CLI
 * 可在不加载 ONNX 权重的情况下复用。
 *
 * 文本构成（中文为主，便于 bge-small-zh）：
 *   名称（含拆词） + 描述（override 优先） + 关键词 + 参数名 + server
 *
 * 见 docs/tool-selection-design.md 层 C。
 */
import { z } from 'zod'
import { catalogById } from './catalog'
import type { ToolCatalogEntry } from './types'

/** 单条嵌入文本的目标上限（超出截断，避免长尾噪声） */
export const TOOL_EMBED_TEXT_MAX_CHARS = 240

/** 描述段上限（官方长描述常带 jail boilerplate，截断即可） */
export const TOOL_EMBED_DESC_MAX_CHARS = 200

/** 参与文本的参数名上限 */
const MAX_PARAM_NAMES = 8

export interface ToolEmbedInput {
  name: string
  description?: string
  /** zod schema（`StructuredToolInterface.schema`）；用于抽参数名 */
  schema?: unknown
}

export interface ToolEmbedTextOptions {
  /** 整体文本上限，默认 `TOOL_EMBED_TEXT_MAX_CHARS` */
  maxChars?: number
  /** 是否追加参数名，默认 true */
  includeParams?: boolean
  /** 是否追加目录关键词，默认 true */
  includeKeywords?: boolean
}

/** `openfile__open_folder` → `openfile`；无前缀返回 undefined */
export function mcpServerOf(toolName: string): string | undefined {
  const i = toolName.indexOf('__')
  return i > 0 ? toolName.slice(0, i) : undefined
}

/** 工具名拆词：`openfile__open_folder` → `openfile open folder` */
export function humanizeToolName(toolName: string): string {
  return toolName
    .replace(/[_.]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 工具 → 嵌入文本。
 *
 * 描述优先级：MCP override（含 `server__tool` 消歧）→ 工具自带 description
 * → 目录条目 title + description。三者皆无时退化为名称本身。
 */
export function toolEmbedText(
  input: ToolEmbedInput,
  options: ToolEmbedTextOptions = {},
): string {
  const name = input.name.trim()
  if (!name) return ''

  const maxChars = options.maxChars ?? TOOL_EMBED_TEXT_MAX_CHARS
  const entry = catalogEntryForTool(name)
  const desc = truncate(
    resolveDescription(input, entry),
    TOOL_EMBED_DESC_MAX_CHARS,
  )

  const human = humanizeToolName(name)
  let text = human === name ? name : `${name}（${human}）`
  if (desc) text += `：${desc}`

  if (options.includeKeywords !== false) {
    const keywords = entry?.keywords?.filter(Boolean) ?? []
    if (keywords.length > 0) text += `｜关键词：${keywords.join('、')}`
  }

  if (options.includeParams !== false) {
    const params = schemaParamNames(input.schema)
    if (params.length > 0) text += `｜参数：${params.join(', ')}`
  }

  const server = mcpServerOf(name)
  if (server) text += `｜server: ${server}`

  return truncate(text, maxChars)
}

/** 批量：`loadMcpTools` / `resolveChatTools` 结果直接喂进来 */
export function toolEmbedTexts(
  tools: readonly ToolEmbedInput[],
  options: ToolEmbedTextOptions = {},
): Array<{ name: string; text: string }> {
  return tools.map((t) => ({ name: t.name, text: toolEmbedText(t, options) }))
}

/** 目录条目 → 嵌入文本（条目级索引 / 关键词预筛用） */
export function catalogEmbedText(
  entry: ToolCatalogEntry,
  options: ToolEmbedTextOptions = {},
): string {
  const maxChars = options.maxChars ?? TOOL_EMBED_TEXT_MAX_CHARS
  const human = humanizeToolName(entry.id)
  let text = human === entry.id ? entry.id : `${entry.id}（${human}）`
  text += `：${truncate(normalizeText(`${entry.title}。${entry.description}`), TOOL_EMBED_DESC_MAX_CHARS)}`

  if (options.includeKeywords !== false && entry.keywords?.length) {
    text += `｜关键词：${entry.keywords.join('、')}`
  }
  // category 是关键元数据，截断主体后强制保留（可能略超预算，但保证维度可用）
  return `${truncate(text, maxChars)}｜category: ${entry.category}`
}

/** 工具名 → 目录条目：目录 id 与运行时工具名一致，直接精确匹配 */
export function catalogEntryForTool(toolName: string): ToolCatalogEntry | undefined {
  return catalogById(toolName)
}

function resolveDescription(input: ToolEmbedInput, entry?: ToolCatalogEntry): string {
  // 目录条目描述即权威（MCP 工具的官方长描述已在此前被覆盖为目录短描述）
  if (entry) return normalizeText(entry.description)
  return normalizeText(input.description ?? '')
}

/** zod schema → 顶层参数名；非对象 schema 或序列化失败返回 [] */
export function schemaParamNames(schema: unknown): string[] {
  if (!schema) return []
  try {
    const json = z.toJSONSchema(schema as z.ZodType) as {
      properties?: Record<string, unknown>
    }
    const keys = Object.keys(json.properties ?? {})
    if (keys.length > 0) return keys.slice(0, MAX_PARAM_NAMES)
  } catch {
    // 落到 shape 兜底
  }
  const shape = (schema as { shape?: Record<string, unknown> } | null)?.shape
  return shape ? Object.keys(shape).slice(0, MAX_PARAM_NAMES) : []
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value
}
