import { describe, expect, it } from 'vitest'
import {
  createMcpFilesystemServer,
  createMcpModsearchServer,
  createMcpOpenfileServer,
  createMcpVmsandboxServer,
  createMcpPyodideServer,
  mergeMcpServers,
  parseMcpServersJson,
  resolveMcpFilesystemServerEntry,
  resolveMcpModsearchServerEntry,
  resolveMcpOpenfileServerEntry,
  resolveMcpVmsandboxServerEntry,
  resolveMcpPyodideServerEntry,
  withDefaultMcpFilesystem,
  withDefaultMcpModsearch,
  withDefaultMcpOpenfile,
  withDefaultMcpVmsandbox,
  withDefaultMcpPyodide,
  MCP_FILESYSTEM_SERVER_NAME,
  MCP_MODSEARCH_SERVER_NAME,
  MCP_OPENFILE_SERVER_NAME,
  MCP_VMSANDBOX_SERVER_NAME,
  MCP_PYODIDE_SERVER_NAME,
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

describe('createMcpFilesystemServer', () => {
  it('points node at server-filesystem with workspace root', () => {
    const conn = createMcpFilesystemServer('E:/ws')
    expect(conn).toMatchObject({
      transport: 'stdio',
      command: process.execPath,
    })
    if (!('args' in conn) || !conn.args) throw new Error('expected args')
    expect(conn.args[0]).toBe(resolveMcpFilesystemServerEntry())
    expect(conn.args[1]).toBe('E:/ws')
    expect(conn.args[0]).toMatch(/server-filesystem[/\\]dist[/\\]index\.js$/)
  })

  it('rejects empty root', () => {
    expect(() => createMcpFilesystemServer('  ')).toThrow(/workspaceRoot/)
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

describe('withDefaultMcpFilesystem', () => {
  it('injects filesystem when missing', () => {
    const servers = withDefaultMcpFilesystem('D:/Chatvein/workspaces', {
      brave: { command: 'npx', args: ['-y', 'x'] },
    })
    expect(servers?.[MCP_FILESYSTEM_SERVER_NAME]).toBeDefined()
    expect(servers?.brave).toBeDefined()
  })

  it('does not override existing filesystem', () => {
    const custom = { command: 'echo', args: ['noop'] }
    const servers = withDefaultMcpFilesystem('D:/ws', {
      [MCP_FILESYSTEM_SERVER_NAME]: custom,
    })
    expect(servers?.[MCP_FILESYSTEM_SERVER_NAME]).toEqual(custom)
  })

  it('mergeMcpServers latter wins', () => {
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
