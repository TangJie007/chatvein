import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { TOOL_CATALOG } from '../catalog'
import {
  TOOL_EMBED_TEXT_MAX_CHARS,
  catalogEmbedText,
  catalogEntryForTool,
  humanizeToolName,
  mcpServerOf,
  schemaParamNames,
  toolEmbedText,
  toolEmbedTexts,
} from '../tool-embed'
import type { ToolEmbedInput } from '../tool-embed'

describe('tool-embed helpers', () => {
  it('mcpServerOf splits server prefix', () => {
    expect(mcpServerOf('openfile__open_folder')).toBe('openfile')
    expect(mcpServerOf('browser_navigate')).toBeUndefined()
    expect(mcpServerOf('calculator')).toBeUndefined()
  })

  it('humanizeToolName expands underscores and camelCase', () => {
    expect(humanizeToolName('openfile__open_folder')).toBe('openfile open folder')
    expect(humanizeToolName('readPage')).toBe('read page')
    expect(humanizeToolName('calculator')).toBe('calculator')
  })

  it('schemaParamNames reads zod object keys', () => {
    expect(schemaParamNames(z.object({ path: z.string(), head: z.number().optional() }))).toEqual(['path', 'head'])
    expect(schemaParamNames(z.string())).toEqual([])
    expect(schemaParamNames(undefined)).toEqual([])
  })
})

describe('toolEmbedText', () => {
  it('prefers catalog description and keeps server tag', () => {
    const text = toolEmbedText({ name: 'openfile__open_folder', description: 'official long description' })
    expect(text).toContain('openfile__open_folder')
    expect(text).toContain('openfile open folder')
    expect(text).toContain('在系统文件管理器中打开文件夹')
    expect(text).not.toContain('official long')
    expect(text).toContain('｜server: openfile')
  })

  it('inherits catalog keywords for MCP sub tools via group', () => {
    const entry = catalogEntryForTool('openfile__open_folder')!
    expect(entry.groupId).toBe('mcp_openfile')
    const text = toolEmbedText({ name: 'openfile__open_folder', description: 'x' })
    expect(text).toContain('关键词：')
  })

  it('falls back to tool description for unknown third-party MCP tools', () => {
    const text = toolEmbedText({
      name: 'notion__create_page',
      description: 'Create a page in a Notion database with given properties.',
      schema: z.object({ database_id: z.string(), properties: z.record(z.unknown()) }),
    })
    expect(text).toContain('notion create page')
    expect(text).toContain('Create a page in a Notion database')
    expect(text).toContain('参数：database_id, properties')
    expect(text).toContain('｜server: notion')
  })

  it('uses catalog entry when tool has no description', () => {
    const text = toolEmbedText({ name: 'calculator' })
    expect(text).toContain('calculator')
    expect(text).toContain('求值数学表达式')
    expect(text).toContain('关键词：')
  })

  it('appends param names for builtin tools', () => {
    const text = toolEmbedText({
      name: 'sqlite_query',
      description: 'Run a read-only SQL query against a SQLite file under the workspace.',
      schema: z.object({ path: z.string(), sql: z.string() }),
    })
    expect(text).toContain('参数：path, sql')
  })

  it('never exceeds maxChars', () => {
    const text = toolEmbedText({ name: 'x'.repeat(400), description: '长描述'.repeat(200) }, { maxChars: 120 })
    expect(text.length).toBeLessThanOrEqual(120)
  })

  it('returns empty string for blank name', () => {
    expect(toolEmbedText({ name: '   ' })).toBe('')
  })

  it('disambiguates same bare name across servers', () => {
    const a = toolEmbedText({ name: 'modsearch__web_search', description: 'a' })
    const of = toolEmbedText({ name: 'openfile__list_allowed_directories', description: 'b' })
    expect(a).toContain('modsearch')
    expect(of).toContain('openfile')
    expect(a).not.toBe(of)
  })

  it('toolEmbedTexts maps a resolved tool list', () => {
    const out = toolEmbedTexts([
      { name: 'openfile__open_folder', description: 'a' },
      { name: 'playwright__browser_click', description: 'b' },
      { name: 'fetch_url', description: 'c', schema: z.object({ url: z.string() }) },
    ])
    expect(out.map((o) => o.name)).toEqual(['openfile__open_folder', 'playwright__browser_click', 'fetch_url'])
    expect(out.every((o) => o.text.length > 0)).toBe(true)
  })

  it('is short enough for bge-small-zh by default', () => {
    for (const tool of SAMPLE_TOOLS) {
      expect(toolEmbedText(tool).length, tool.name).toBeLessThanOrEqual(TOOL_EMBED_TEXT_MAX_CHARS)
    }
  })
})

describe('catalogEmbedText', () => {
  it('renders id, title, keywords and category', () => {
    const text = catalogEmbedText(catalogEntryForTool('openfile__open_folder')!)
    expect(text).toContain('openfile__open_folder（openfile open folder）')
    expect(text).toContain('在系统文件管理器中打开文件夹')
    expect(text).toContain('关键词：')
    expect(text).toContain('｜category: local_fs')
  })

  it('every catalog entry has keywords and carries category', () => {
    for (const entry of TOOL_CATALOG) {
      expect(entry.keywords?.length ?? 0, entry.id).toBeGreaterThan(0)
      const text = catalogEmbedText(entry)
      // 主体截断到预算；category 元数据强制追加，可略超
      expect(text.length, entry.id).toBeLessThanOrEqual(TOOL_EMBED_TEXT_MAX_CHARS + 24)
      expect(text, entry.id).toContain(`｜category: ${entry.category}`)
    }
  })
})

const SAMPLE_TOOLS: ToolEmbedInput[] = [
  { name: 'openfile__open_folder', description: 'official long description' },
  { name: 'playwright__browser_click', description: 'b' },
  {
    name: 'fetch_url',
    description: 'Fetch a public http(s) URL and return approximate plain text.',
    schema: z.object({ url: z.string() }),
  },
]
