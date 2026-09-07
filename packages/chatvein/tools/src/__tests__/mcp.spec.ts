import { describe, expect, it } from 'vitest'
import {
  createMcpModsearchServer,
  createMcpOpenfileServer,
  createMcpVmsandboxServer,
  createMcpPyodideServer,
  createMcpPlaywrightServer,
  mergeMcpServers,
  parseMcpServersJson,
  resolveMcpModsearchServerEntry,
  resolveMcpOpenfileServerEntry,
  resolveMcpVmsandboxServerEntry,
  resolveMcpPyodideServerEntry,
  resolveMcpPlaywrightServerEntry,
  withDefaultMcpModsearch,
  withDefaultMcpOpenfile,
  withDefaultMcpVmsandbox,
  withDefaultMcpPyodide,
  withDefaultMcpPlaywright,
  MCP_MODSEARCH_SERVER_NAME,
  MCP_OPENFILE_SERVER_NAME,
  MCP_VMSANDBOX_SERVER_NAME,
  MCP_PYODIDE_SERVER_NAME,
  MCP_PLAYWRIGHT_SERVER_NAME,
} from '../mcp'

describe('parseMcpServersJson', () => {
  it('returns undefined for empty', () => {
    expect(parseMcpServersJson(undefined)).toBeUndefined()
    expect(parseMcpServersJson('')).toBeUndefined()
  })

  it('parses object', () => {
    const servers = parseMcpServersJson(
      JSON.stringify({
        math: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-math'] },
      }),
    )
    expect(servers?.math).toMatchObject({ command: 'npx' })
  })

  it('rejects non-object', () => {
    expect(parseMcpServersJson('[]')).toBeUndefined()
    expect(parseMcpServersJson('"x"')).toBeUndefined()
  })
})

describe('createMcpOpenfileServer', () => {
  it('points node at mcp-openfile-sdk cli with workspace root', () => {
    const conn = createMcpOpenfileServer('E:/ws')
    expect(conn).toMatchObject({
      transport: 'stdio',
      command: process.execPath,
    })
    if (!('args' in conn) || !conn.args) throw new Error('expected args')
    expect(conn.args[0]).toBe(resolveMcpOpenfileServerEntry())
    expect(conn.args[1]).toBe('E:/ws')
    expect(conn.args[0]).toMatch(/openfile[/\\]dist[/\\]cli\.js$/)
  })

  it('rejects empty root', () => {
    expect(() => createMcpOpenfileServer('  ')).toThrow(/workspaceRoot/)
  })
})

describe('mergeMcpServers', () => {
  it('latter wins', () => {
    const merged = mergeMcpServers(
      { a: { command: '1', args: [] } },
      { a: { command: '2', args: ['x'] } },
    )
    expect(merged?.a).toMatchObject({ command: '2' })
  })
})

describe('withDefaultMcpOpenfile', () => {
  it('injects openfile when missing', () => {
    const servers = withDefaultMcpOpenfile('D:/ws', {
      brave: { command: 'npx', args: ['-y', 'x'] },
    })
    expect(servers?.[MCP_OPENFILE_SERVER_NAME]).toBeDefined()
    expect(servers?.brave).toBeDefined()
  })

  it('does not override existing openfile', () => {
    const custom = { command: 'echo', args: ['noop'] }
    const servers = withDefaultMcpOpenfile('D:/ws', {
      [MCP_OPENFILE_SERVER_NAME]: custom,
    })
    expect(servers?.[MCP_OPENFILE_SERVER_NAME]).toEqual(custom)
  })
})

describe('createMcpModsearchServer', () => {
  it('points node at mcp-modsearch-sdk cli', () => {
    const conn = createMcpModsearchServer()
    expect(conn).toMatchObject({
      transport: 'stdio',
      command: process.execPath,
    })
    if (!('args' in conn) || !conn.args) throw new Error('expected args')
    expect(conn.args[0]).toBe(resolveMcpModsearchServerEntry())
    expect(conn.args[0]).toMatch(/modsearch[/\\]dist[/\\]cli\.js$/)
  })

  it('passes timeout and no-fallback flags', () => {
    const conn = createMcpModsearchServer({ timeoutMs: 90_000, fallback: false })
    if (!('args' in conn) || !conn.args) throw new Error('expected args')
    expect(conn.args).toContain('--timeout=90000')
    expect(conn.args).toContain('--no-fallback')
  })
})

describe('withDefaultMcpModsearch', () => {
  it('injects modsearch when missing', () => {
    const servers = withDefaultMcpModsearch({
      brave: { command: 'npx', args: ['-y', 'x'] },
    })
    expect(servers?.[MCP_MODSEARCH_SERVER_NAME]).toBeDefined()
    expect(servers?.brave).toBeDefined()
  })

  it('does not override existing modsearch', () => {
    const custom = { command: 'echo', args: ['noop'] }
    const servers = withDefaultMcpModsearch({
      [MCP_MODSEARCH_SERVER_NAME]: custom,
    })
    expect(servers?.[MCP_MODSEARCH_SERVER_NAME]).toEqual(custom)
  })
})

describe('createMcpVmsandboxServer', () => {
  it('points node at mcp-vmsandbox-sdk cli with workspace root', () => {
    const conn = createMcpVmsandboxServer('E:/ws')
    expect(conn).toMatchObject({
      transport: 'stdio',
      command: process.execPath,
    })
    if (!('args' in conn) || !conn.args) throw new Error('expected args')
    expect(conn.args[0]).toBe(resolveMcpVmsandboxServerEntry())
    expect(conn.args[1]).toBe('E:/ws')
    expect(conn.args[0]).toMatch(/vmsandbox[/\\]dist[/\\]cli\.js$/)
  })

  it('rejects empty root', () => {
    expect(() => createMcpVmsandboxServer('  ')).toThrow(/workspaceRoot/)
  })
})

describe('withDefaultMcpVmsandbox', () => {
  it('injects vmsandbox when missing', () => {
    const servers = withDefaultMcpVmsandbox('D:/ws', {})
    expect(servers?.[MCP_VMSANDBOX_SERVER_NAME]).toBeDefined()
  })

  it('skips without workspace', () => {
    expect(withDefaultMcpVmsandbox(undefined, {})).toEqual({})
  })
})

describe('createMcpPyodideServer', () => {
  it('points node at mcp-pyodide-sdk cli with workspace root', () => {
    const conn = createMcpPyodideServer('E:/ws')
    expect(conn).toMatchObject({
      transport: 'stdio',
      command: process.execPath,
    })
    if (!('args' in conn) || !conn.args) throw new Error('expected args')
    expect(conn.args[0]).toBe(resolveMcpPyodideServerEntry())
    expect(conn.args[1]).toBe('E:/ws')
    expect(conn.args[0]).toMatch(/pyodide[/\\]dist[/\\]cli\.js$/)
  })

  it('rejects empty root', () => {
    expect(() => createMcpPyodideServer('  ')).toThrow(/workspaceRoot/)
  })
})

describe('withDefaultMcpPyodide', () => {
  it('injects pyodide when missing', () => {
    const servers = withDefaultMcpPyodide('D:/ws', {})
    expect(servers?.[MCP_PYODIDE_SERVER_NAME]).toBeDefined()
  })

  it('skips without workspace', () => {
    expect(withDefaultMcpPyodide(undefined, {})).toEqual({})
  })
})

describe('createMcpPlaywrightServer', () => {
  it('points node at @playwright/mcp cli with headless', () => {
    const conn = createMcpPlaywrightServer()
    expect(conn).toMatchObject({
      transport: 'stdio',
      command: process.execPath,
    })
    if (!('args' in conn) || !conn.args) throw new Error('expected args')
    expect(conn.args[0]).toBe(resolveMcpPlaywrightServerEntry())
    expect(conn.args).toContain('--headless')
    expect(conn.args[0]).toMatch(/@playwright[/\\]mcp[/\\]cli\.js$/)
  })

  it('can disable headless', () => {
    const conn = createMcpPlaywrightServer({ headless: false, browser: 'firefox' })
    if (!('args' in conn) || !conn.args) throw new Error('expected args')
    expect(conn.args).not.toContain('--headless')
    expect(conn.args).toContain('--browser=firefox')
  })
})

describe('withDefaultMcpPlaywright', () => {
  it('injects playwright when missing', () => {
    const servers = withDefaultMcpPlaywright({})
    expect(servers?.[MCP_PLAYWRIGHT_SERVER_NAME]).toBeDefined()
  })

  it('skips when disabled', () => {
    expect(withDefaultMcpPlaywright({}, false)).toEqual({})
  })
})
