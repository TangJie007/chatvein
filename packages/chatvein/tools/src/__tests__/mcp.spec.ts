import { describe, expect, it } from 'vitest'
import { parseMcpServersJson } from '../mcp'

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
