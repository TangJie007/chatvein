import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createStateFilesystemMiddleware,
  seedFilesFromDisk,
  flushFilesToDisk,
  textToFileData,
  fileDataToText,
  toVirtualPath,
  toRelativePath,
  isWorkspaceVirtualPath,
  WORKSPACE_ROUTE_PREFIX,
} from '../filesystem'

describe('createStateFilesystemMiddleware', () => {
  it('requires rootDir', () => {
    expect(() => createStateFilesystemMiddleware({ rootDir: '  ' })).toThrow(/rootDir/)
  })

  it('builds middleware with CompositeBackend tools', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fs-mw-'))
    try {
      const mw = createStateFilesystemMiddleware({ rootDir: dir })
      expect(mw).toBeTruthy()
      expect(mw.name).toBeTruthy()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('path helpers', () => {
  it('normalizes workspace / scratch virtual paths', () => {
    expect(toVirtualPath('src/a.ts')).toBe('/workspace/src/a.ts')
    expect(toVirtualPath('/workspace/src/a.ts')).toBe('/workspace/src/a.ts')
    expect(toVirtualPath('/draft.md')).toBe('/draft.md')
    expect(toRelativePath('/workspace/src/a.ts')).toBe('src/a.ts')
    expect(toRelativePath('/draft.md')).toBe('draft.md')
    expect(isWorkspaceVirtualPath('/workspace/src/a.ts')).toBe(true)
    expect(isWorkspaceVirtualPath('/draft.md')).toBe(false)
    expect(WORKSPACE_ROUTE_PREFIX).toBe('/workspace/')
  })

  it('round-trips FileData text', () => {
    const data = textToFileData('hello\n')
    expect(fileDataToText(data)).toBe('hello\n')
  })
})

describe('seedFilesFromDisk / flushFilesToDisk', () => {
  it('seeds State keys and flushes non-workspace paths', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fs-seed-'))
    try {
      mkdirSync(join(dir, 'src'))
      writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 1\n', 'utf8')
      writeFileSync(join(dir, 'readme.md'), '# hi\n', 'utf8')
      mkdirSync(join(dir, 'node_modules', 'x'), { recursive: true })
      writeFileSync(join(dir, 'node_modules', 'x', 'index.js'), 'skip\n', 'utf8')

      const files = await seedFilesFromDisk(dir)
      expect(files['/src/a.ts']).toBeTruthy()
      expect(files['/readme.md']).toBeTruthy()
      expect(files['/node_modules/x/index.js']).toBeUndefined()
      expect(files['/workspace/src/a.ts']).toBeUndefined()

      files['/scratch/b.ts'] = textToFileData('export const b = 2\n')
      files['/workspace/ignored.ts'] = textToFileData('skip\n')
      const written = await flushFilesToDisk(dir, files)
      expect(written).toContain('scratch/b.ts')
      expect(written).not.toContain('ignored.ts')
      expect(readFileSync(join(dir, 'scratch', 'b.ts'), 'utf8')).toBe('export const b = 2\n')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
