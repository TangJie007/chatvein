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
} from '../filesystem'

describe('createStateFilesystemMiddleware', () => {
  it('builds middleware with StateBackend tools', () => {
    const mw = createStateFilesystemMiddleware()
    expect(mw).toBeTruthy()
    expect(mw.name).toBeTruthy()
  })
})

describe('path helpers', () => {
  it('normalizes virtual / relative paths', () => {
    expect(toVirtualPath('src/a.ts')).toBe('/src/a.ts')
    expect(toVirtualPath('/src/a.ts')).toBe('/src/a.ts')
    expect(toRelativePath('/src/a.ts')).toBe('src/a.ts')
  })

  it('round-trips FileData text', () => {
    const data = textToFileData('hello\n')
    expect(fileDataToText(data)).toBe('hello\n')
  })
})

describe('seedFilesFromDisk / flushFilesToDisk', () => {
  it('seeds and flushes text files', async () => {
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

      files['/src/b.ts'] = textToFileData('export const b = 2\n')
      const written = await flushFilesToDisk(dir, files)
      expect(written).toContain('src/b.ts')
      expect(readFileSync(join(dir, 'src', 'b.ts'), 'utf8')).toBe('export const b = 2\n')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
