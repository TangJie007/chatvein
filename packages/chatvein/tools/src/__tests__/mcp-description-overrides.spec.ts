import { describe, expect, it } from 'vitest'
import type { StructuredToolInterface } from '@langchain/core/tools'
import {
  MCP_FILESYSTEM_DESCRIPTION_OVERRIDES,
  MCP_MODSEARCH_DESCRIPTION_OVERRIDES,
  MCP_OPENFILE_DESCRIPTION_OVERRIDES,
  MCP_PLAYWRIGHT_DESCRIPTION_OVERRIDES,
  MCP_PYODIDE_DESCRIPTION_OVERRIDES,
  MCP_TOOL_DESCRIPTION_OVERRIDES,
  MCP_VMSANDBOX_DESCRIPTION_OVERRIDES,
  applyMcpDescriptionOverrides,
  mcpToolEmbedText,
  resolveMcpDescriptionOverride,
} from '../mcp-description-overrides'

function fakeTool(name: string, description: string): StructuredToolInterface {
  return { name, description } as StructuredToolInterface
}

describe('mcp description overrides', () => {
  it('resolves filesystem by bare and prefixed name', () => {
    const expected = MCP_FILESYSTEM_DESCRIPTION_OVERRIDES.read_text_file
    expect(resolveMcpDescriptionOverride('read_text_file')).toBe(expected)
    expect(resolveMcpDescriptionOverride('filesystem__read_text_file')).toBe(expected)
  })

  it('disambiguates same bare name across servers via prefix', () => {
    expect(resolveMcpDescriptionOverride('filesystem__list_allowed_directories')).toBe(
      MCP_FILESYSTEM_DESCRIPTION_OVERRIDES['filesystem__list_allowed_directories'],
    )
    expect(resolveMcpDescriptionOverride('openfile__list_allowed_directories')).toBe(
      MCP_OPENFILE_DESCRIPTION_OVERRIDES['openfile__list_allowed_directories'],
    )
    expect(resolveMcpDescriptionOverride('vmsandbox__run_workspace_script')).toContain('NodeVM')
    expect(resolveMcpDescriptionOverride('pyodide__run_workspace_script')).toContain('Pyodide')
  })

  it('covers openfile / modsearch / playwright / sandboxes', () => {
    expect(resolveMcpDescriptionOverride('openfile__open_folder')).toBe(
      MCP_OPENFILE_DESCRIPTION_OVERRIDES.open_folder,
    )
    expect(resolveMcpDescriptionOverride('modsearch__web_search')).toBe(
      MCP_MODSEARCH_DESCRIPTION_OVERRIDES.web_search,
    )
    expect(resolveMcpDescriptionOverride('playwright__browser_navigate')).toBe(
      MCP_PLAYWRIGHT_DESCRIPTION_OVERRIDES.browser_navigate,
    )
    expect(resolveMcpDescriptionOverride('vmsandbox__run_js')).toBe(
      MCP_VMSANDBOX_DESCRIPTION_OVERRIDES.run_js,
    )
    expect(resolveMcpDescriptionOverride('pyodide__run_py')).toBe(
      MCP_PYODIDE_DESCRIPTION_OVERRIDES.run_py,
    )
  })

  it('overrides description in place for prefixed MCP tools', () => {
    const tools = [
      fakeTool('filesystem__write_file', 'Create a new file... Only works within allowed directories.'),
      fakeTool('modsearch__read_page', 'long official'),
      fakeTool('playwright__browser_click', 'Perform click on a web page'),
      fakeTool('unknown__tool', 'keep me'),
    ]
    applyMcpDescriptionOverrides(tools)
    expect(tools[0]!.description).toBe(MCP_FILESYSTEM_DESCRIPTION_OVERRIDES.write_file)
    expect(tools[1]!.description).toBe(MCP_MODSEARCH_DESCRIPTION_OVERRIDES.read_page)
    expect(tools[2]!.description).toBe(MCP_PLAYWRIGHT_DESCRIPTION_OVERRIDES.browser_click)
    expect(tools[3]!.description).toBe('keep me')
  })

  it('mcpToolEmbedText prefixes name for indexing', () => {
    expect(mcpToolEmbedText('search_files', 'filesystem')).toMatch(/^filesystem__search_files: /)
    expect(mcpToolEmbedText('list_allowed_directories', 'openfile')).toContain('openfile__')
    expect(mcpToolEmbedText('browser_navigate', 'playwright')).toMatch(/^playwright__browser_navigate: /)
  })

  it('merged overrides stay short and avoid filesystem jail boilerplate', () => {
    for (const [name, desc] of Object.entries(MCP_TOOL_DESCRIPTION_OVERRIDES)) {
      expect(desc.toLowerCase(), name).not.toContain('only works within allowed directories')
      expect(desc.length, name).toBeLessThan(280)
    }
  })

  it('playwright table covers browser_* catalog', () => {
    expect(Object.keys(MCP_PLAYWRIGHT_DESCRIPTION_OVERRIDES).length).toBeGreaterThanOrEqual(70)
  })
})
