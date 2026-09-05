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

  it('binds calculator and local read when full + workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'chatvein-tools-'))
    await writeFile(join(root, 'hello.txt'), 'hello-tools', 'utf8')
    await mkdir(join(root, 'sub'))

    const tools = await resolveChatTools({
      policy: 'full',
      workspaceRoot: root,
      allowIds: ['calculator', 'read_file', 'list_dir', 'js_eval'],
    })
    const names = tools.map((t) => t.name).sort()
    expect(names).toEqual(['calculator', 'js_eval', 'list_dir', 'read_file'])

    const read = tools.find((t) => t.name === 'read_file')!
    const text = await read.invoke({ path: 'hello.txt' })
    expect(text).toContain('hello-tools')

    const calc = tools.find((t) => t.name === 'calculator')!
    const sum = await calc.invoke('2+3')
    expect(sum).toBe('5')
  })
})
