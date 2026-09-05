import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  normalizePackageName,
  checkPackageTrust,
  TRUSTED_PACKAGE_ALLOWLIST,
} from '../trust'
import { runWorkspaceScript } from '../run'

describe('normalizePackageName', () => {
  it('accepts plain and versioned', () => {
    expect(normalizePackageName('numpy')).toBe('numpy')
    expect(normalizePackageName('beautifulsoup4==4.12')).toBe('beautifulsoup4')
    expect(normalizePackageName('PyYAML')).toBe('pyyaml')
  })

  it('rejects urls and paths', () => {
    expect(normalizePackageName('git+https://x')).toBeNull()
    expect(normalizePackageName('https://pypi.org/x')).toBeNull()
    expect(normalizePackageName('../evil')).toBeNull()
  })
})

describe('checkPackageTrust', () => {
  it('allows hard allowlist offline', async () => {
    const name = [...TRUSTED_PACKAGE_ALLOWLIST][0]
    const r = await checkPackageTrust(name, {
      minWeeklyDownloads: 1,
      offlineAllowlistOnly: true,
    })
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
        json: async () => ({ data: { last_week: 5_000_000 } }),
      })),
    )
    const r = await checkPackageTrust('some-popular-lib', {
      minWeeklyDownloads: 1_000_000,
    })
    expect(r.trusted).toBe(true)
    expect(r.source).toBe('downloads')
    vi.unstubAllGlobals()
  })
})

describe('runWorkspaceScript + Pyodide', () => {
  it(
    'runs expression script',
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'pyodide-mcp-'))
      await mkdir(join(root, 'scripts'), { recursive: true })
      await writeFile(join(root, 'scripts', 'add.py'), '1 + 41', 'utf8')
      const r = await runWorkspaceScript({
        workspaceRoot: root,
        path: 'scripts/add.py',
        timeoutMs: 120_000,
      })
      expect(r.ok).toBe(true)
      expect(r.result).toBe('42')
    },
    180_000,
  )
})
