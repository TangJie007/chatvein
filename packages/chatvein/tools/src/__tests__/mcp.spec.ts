import { describe, expect, it } from 'vitest'
import {
  createMcpFilesystemServer,
  mergeMcpServers,
  parseMcpServersJson,
  resolveMcpFilesystemServerEntry,
  withDefaultMcpFilesystem,
  MCP_FILESYSTEM_SERVER_NAME,
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
