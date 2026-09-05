import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  normalizePackageName,
  checkPackageTrust,
  TRUSTED_PACKAGE_ALLOWLIST,
} from '../trust'
import { prepareModuleSource, runWorkspaceScript } from '../run'

describe('normalizePackageName', () => {
  it('accepts plain and scoped', () => {
    expect(normalizePackageName('lodash')).toBe('lodash')
    expect(normalizePackageName('lodash@4.17.21')).toBe('lodash')
    expect(normalizePackageName('@types/node@20')).toBe('@types/node')
  })

  it('rejects urls and paths', () => {
    expect(normalizePackageName('git+https://x')).toBeNull()
    expect(normalizePackageName('file:../evil')).toBeNull()
    expect(normalizePackageName('../lodash')).toBeNull()
  })
})

describe('checkPackageTrust', () => {
  it('allows hard allowlist offline', async () => {
    const name = [...TRUSTED_PACKAGE_ALLOWLIST][0]
    const r = await checkPackageTrust(name, { minWeeklyDownloads: 1, offlineAllowlistOnly: true })
    expect(r.trusted).toBe(true)
    expect(r.source).toBe('allowlist')
  })

  it('denies unknown offline', async () => {
    const r = await checkPackageTrust('totally-unknown-pkg-xyz-12345', {
      minWeeklyDownloads: 1,
      offlineAllowlistOnly: true,
    })
    expect(r.trusted).toBe(false)
  })

  it('uses downloads when not on allowlist', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ downloads: 5_000_000 }),
      })),
    )
    const r = await checkPackageTrust('some-popular-lib', {
      minWeeklyDownloads: 1_000_000,
    })
    expect(r.trusted).toBe(true)
    expect(r.source).toBe('downloads')
    vi.unstubAllGlobals()
  })

  it('rejects low downloads', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ downloads: 10 }),
      })),
    )
    const r = await checkPackageTrust('obscure-pkg', { minWeeklyDownloads: 1_000_000 })
    expect(r.trusted).toBe(false)
    vi.unstubAllGlobals()
  })
})

describe('prepareModuleSource', () => {
  it('wraps bare expressions', () => {
    expect(prepareModuleSource('1+2')).toContain('module.exports = (1+2)')
  })

  it('keeps require scripts', () => {
    const src = prepareModuleSource('const x = require("lodash"); module.exports = x')
    expect(src).toContain('require("lodash")')
    expect(src.startsWith('"use strict"')).toBe(true)
  })
})

describe('runWorkspaceScript + NodeVM', () => {
  it('runs expression script', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vmsandbox-'))
    await mkdir(join(root, 'scripts'), { recursive: true })
    await writeFile(join(root, 'scripts', 'add.js'), '1 + 41', 'utf8')
    const r = await runWorkspaceScript({ workspaceRoot: root, path: 'scripts/add.js' })
    expect(r.ok).toBe(true)
    expect(r.result).toBe('42')
  })
})
