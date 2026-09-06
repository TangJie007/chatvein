import { describe, expect, it } from 'vitest'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { TOOL_CATALOG, TOOL_CATALOG_GROUPS, catalogByGroup } from '../catalog'
import { applyCatalogDescriptions, resolveCatalogDescription } from '../catalog-descriptions'

function fakeTool(name: string, description: string): StructuredToolInterface {
  return { name, description } as StructuredToolInterface
}

describe('catalog descriptions', () => {
  it('resolves by prefixed id', () => {
    expect(resolveCatalogDescription('filesystem__read_text_file')).toContain('读取单个文本文件内容')
  })

  it('resolves by bare name for single-server tools', () => {
    expect(resolveCatalogDescription('browser_navigate')).toContain('浏览器打开/跳转')
  })

  it('disambiguates same bare name across servers via prefix', () => {
    expect(resolveCatalogDescription('filesystem__list_allowed_directories')).toContain('filesystem')
    expect(resolveCatalogDescription('openfile__list_allowed_directories')).toContain('openfile')
  })

  it('overrides description in place for prefixed MCP tools', () => {
    const tools = [
      fakeTool('filesystem__write_file', 'Create a new file... Only works within allowed directories.'),
      fakeTool('modsearch__read_page', 'long official'),
      fakeTool('playwright__browser_click', 'Perform click on a web page'),
      fakeTool('unknown__tool', 'keep me'),
    ]
    applyCatalogDescriptions(tools)
    expect(tools[0]!.description).toContain('新建或整文件覆盖写入')
    expect(tools[1]!.description).toContain('抓取单个网页正文')
    expect(tools[2]!.description).toContain('点击页面元素')
    expect(tools[3]!.description).toBe('keep me')
  })

  it('all descriptions stay short and avoid filesystem jail boilerplate', () => {
    for (const entry of TOOL_CATALOG) {
      expect(entry.description.toLowerCase(), entry.id).not.toContain('only works within allowed directories')
      expect(entry.description.length, entry.id).toBeLessThan(280)
    }
  })

  it('playwright table covers browser_* catalog (>70)', () => {
    expect(catalogByGroup('mcp_playwright').length).toBeGreaterThanOrEqual(70)
  })

  it('unique ids; MCP groups carry a server', () => {
    const ids = new Set(TOOL_CATALOG.map((e) => e.id))
    expect(ids.size, 'id 唯一').toBe(TOOL_CATALOG.length)
    for (const g of TOOL_CATALOG_GROUPS) {
      expect(g.mcpServer, g.id).toBeTruthy()
    }
  })
})
