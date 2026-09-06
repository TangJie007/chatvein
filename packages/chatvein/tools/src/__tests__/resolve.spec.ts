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

  it('local_fs tools belong to filesystem / openfile groups', () => {
    const local = TOOL_CATALOG.filter((e) => e.category === 'local_fs')
    expect(local.every((e) => e.groupId === 'mcp_filesystem' || e.groupId === 'mcp_openfile')).toBe(true)
    expect(local.every((e) => e.mcp?.server === 'filesystem' || e.mcp?.server === 'openfile')).toBe(true)
  })

  it('search prefers mcp_modsearch by default', () => {
    const search = TOOL_CATALOG.filter((e) => e.category === 'search')
    expect(search.some((e) => e.id === 'modsearch__web_search' && e.defaultEnabled)).toBe(true)
    expect(search.find((e) => e.id === 'duckduckgo_search')?.defaultEnabled).toBe(false)
  })

  it('compute prefers mcp_vmsandbox / mcp_pyodide over js_eval', () => {
    expect(TOOL_CATALOG.find((e) => e.id === 'vmsandbox__run_workspace_script')?.defaultEnabled).toBe(true)
    expect(TOOL_CATALOG.find((e) => e.id === 'pyodide__run_workspace_script')?.defaultEnabled).toBe(true)
    expect(TOOL_CATALOG.find((e) => e.id === 'js_eval')?.defaultEnabled).toBe(false)
  })

  it('web includes mcp_playwright high-frequency tools by default', () => {
    const pw = TOOL_CATALOG.filter((e) => e.groupId === 'mcp_playwright')
    expect(pw.some((e) => e.id === 'playwright__browser_navigate' && e.defaultEnabled)).toBe(true)
    expect(pw.some((e) => e.id === 'playwright__browser_run_code_unsafe' && e.defaultEnabled)).toBe(false)
  })

  it('deprecated filesystem read_file is excluded from default set', () => {
    expect(TOOL_CATALOG.find((e) => e.id === 'filesystem__read_file')?.deprecated).toBe(true)
    expect(TOOL_CATALOG.find((e) => e.id === 'filesystem__read_file')?.defaultEnabled).toBe(false)
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

  it('binds calculator + js_eval via explicit allowIds (bypass defaultEnabled)', async () => {
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
    expect(names.some((n) => n.startsWith('filesystem__'))).toBe(false)

    const calc = tools.find((t) => t.name === 'calculator')!
    const sum = await calc.invoke('2+3')
    expect(sum).toBe('5')
  })
})
