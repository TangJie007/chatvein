import { describe, expect, it } from 'vitest'
import {
  STATE_FILESYSTEM_TOOL_NAMES,
  normalizeStateFilesystemAllowlist,
  stateFilesystemCustomDescriptions,
  selectStateFilesystemCatalogEntries,
  isStateFilesystemToolId,
} from '../catalog/tools-state-filesystem'

describe('state_filesystem helpers', () => {
  it('customToolDescriptions covers all FS tools', () => {
    const d = stateFilesystemCustomDescriptions()
    for (const name of STATE_FILESYSTEM_TOOL_NAMES) {
      expect(d[name]?.length).toBeGreaterThan(10)
    }
  })

  it('normalizeStateFilesystemAllowlist forces read_file', () => {
    expect(normalizeStateFilesystemAllowlist([])).toBeNull()
    expect(normalizeStateFilesystemAllowlist(['write_file', 'ls'])).toEqual([
      'read_file',
      'ls',
      'write_file',
    ])
    expect(normalizeStateFilesystemAllowlist(['read_file', 'grep'])).toEqual(['read_file', 'grep'])
  })

  it('selectStateFilesystemCatalogEntries respects policy and workspace', () => {
    expect(
      selectStateFilesystemCatalogEntries({ policy: 'none', allowIds: 'all', workspaceRoot: '/ws' }),
    ).toEqual([])
    expect(
      selectStateFilesystemCatalogEntries({ policy: 'full', allowIds: 'all' }),
    ).toEqual([])
    const all = selectStateFilesystemCatalogEntries({
      policy: 'full',
      allowIds: 'all',
      workspaceRoot: '/ws',
    })
    expect(all).toHaveLength(6)
    const onlyRead = selectStateFilesystemCatalogEntries({
      policy: 'full',
      allowIds: ['read_file'],
      workspaceRoot: '/ws',
    })
    expect(onlyRead.map((e) => e.id)).toEqual(['read_file'])
    const byGroup = selectStateFilesystemCatalogEntries({
      policy: 'full',
      allowIds: ['state_filesystem'],
      workspaceRoot: '/ws',
    })
    expect(byGroup).toHaveLength(6)
  })

  it('isStateFilesystemToolId', () => {
    expect(isStateFilesystemToolId('read_file')).toBe(true)
    expect(isStateFilesystemToolId('openfile__open_folder')).toBe(false)
  })
})
