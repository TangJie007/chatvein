import { mkdtemp, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertAllowed,
  isPathWithin,
  resolveFolderToOpen,
} from '../open'

describe('isPathWithin', () => {
  it('accepts root and nested', () => {
    expect(isPathWithin('E:/ws', 'E:/ws')).toBe(true)
    expect(isPathWithin('E:/ws', 'E:/ws/a/b')).toBe(true)
  })

  it('rejects sibling escape', () => {
    expect(isPathWithin('E:/ws', 'E:/other')).toBe(false)
    expect(isPathWithin('E:/ws', 'E:/ws2')).toBe(false)
  })
})

describe('resolveFolderToOpen', () => {
  it('opens directory as-is', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mcp-openfile-'))
    const sub = join(root, 'docs')
    await mkdir(sub)

    const r = await resolveFolderToOpen(sub, [root])
    expect(r.kind).toBe('dir')
    expect(r.folder).toBe(sub)
  })

  it('opens parent when path is a file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mcp-openfile-'))
    const file = join(root, 'readme.txt')
    await writeFile(file, 'hi', 'utf8')

    const r = await resolveFolderToOpen(file, [root])
    expect(r.kind).toBe('file')
    expect(r.folder).toBe(dirname(file))
    expect(r.input).toBe(file)
  })

  it('rejects path outside allowed roots', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mcp-openfile-'))
    const other = await mkdtemp(join(tmpdir(), 'mcp-openfile-out-'))
    await expect(resolveFolderToOpen(other, [root])).rejects.toThrow(/越出/)
  })

  it('rejects missing path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mcp-openfile-'))
    await expect(resolveFolderToOpen(join(root, 'nope'), [root])).rejects.toThrow(
      /不存在/,
    )
  })
})

describe('assertAllowed', () => {
  it('no-ops when roots empty', () => {
    expect(() => assertAllowed('/anywhere', [])).not.toThrow()
  })
})
