import { mkdtemp, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TOOL_CATALOG } from '../catalog'
import { resolveInWorkspace } from '../guards'
import { resolveChatTools } from '../resolve'

describe('TOOL_CATALOG', () => {
  it('covers seven categories', () => {
    const cats = new Set(TOOL_CATALOG.map((e) => e.category))
    expect(cats).toEqual(
      new Set([
        'search',
        'compute',
        'local_fs',
        'web',
        'news_finance',
        'database',
        'knowledge',
      ]),
    )
  })

  it('local_fs is MCP-only (filesystem + openfile)', () => {
    const local = TOOL_CATALOG.filter((e) => e.category === 'local_fs')
    expect(local.map((e) => e.id)).toEqual(['mcp_filesystem', 'mcp_openfile'])
    expect(local.every((e) => e.source.startsWith('mcp:'))).toBe(true)
  })

  it('search prefers mcp_modsearch by default', () => {
    const search = TOOL_CATALOG.filter((e) => e.category === 'search')
    expect(search.some((e) => e.id === 'mcp_modsearch' && e.defaultEnabled)).toBe(true)
    expect(search.find((e) => e.id === 'duckduckgo_search')?.defaultEnabled).toBe(false)
  })
})

describe('resolveInWorkspace', () => {
  it('rejects path escape', () => {
    expect(() => resolveInWorkspace('/tmp/ws', '../etc/passwd')).toThrow(/越出/)
  })
})

describe('resolveChatTools', () => {
  it('returns empty when policy is none', async () => {
    const tools = await resolveChatTools({ policy: 'none' })
    expect(tools).toEqual([])
  })

  it('binds calculator without builtin local_fs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'chatvein-tools-'))
    await writeFile(join(root, 'hello.txt'), 'hello-tools', 'utf8')
    await mkdir(join(root, 'sub'))

    const tools = await resolveChatTools({
      policy: 'full',
      workspaceRoot: root,
      allowIds: ['calculator', 'js_eval'],
      mcpFilesystem: false,
    })
    const names = tools.map((t) => t.name).sort()
    expect(names).toEqual(['calculator', 'js_eval'])
    expect(names.some((n) => n === 'read_file' || n.startsWith('filesystem__'))).toBe(false)

    const calc = tools.find((t) => t.name === 'calculator')!
    const sum = await calc.invoke('2+3')
    expect(sum).toBe('5')
  })
})
