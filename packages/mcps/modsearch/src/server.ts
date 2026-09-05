import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { envelopeToText, readPage, webSearch } from './run'

export interface CreateModsearchServerOptions {
  /** ModSearch CLI 超时（默认 60s） */
  timeoutMs?: number
  /** 失败是否 DuckDuckGo / HTTP 兜底（默认 true） */
  fallback?: boolean
}

export function createModsearchMcpServer(
  options: CreateModsearchServerOptions = {},
): McpServer {
  const timeoutMs = options.timeoutMs ?? 60_000
  const fallback = options.fallback !== false

  const server = new McpServer({
    name: 'chatvein-modsearch',
    version: '0.1.0',
  })

  server.registerTool(
    'web_search',
    {
      title: 'Web Search',
      description:
        '联网搜索。优先走 ModSearch（Firecrawl 免注册链 + 可配置引擎故障转移）；' +
        '全部失败时兜底 DuckDuckGo。返回 JSON（summary / items / uncertainty / fallback）。',
      inputSchema: {
        query: z.string().describe('搜索查询'),
        maxResults: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe('最多返回条数，默认 8'),
        source: z
          .enum(['web', 'x', 'web,x'])
          .optional()
          .describe('语料：web / x / web,x；默认 web'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ query, maxResults, source }) => {
      try {
        const env = await webSearch({
          query,
          maxResults,
          source,
          timeoutMs,
          fallback,
        })
        return {
          content: [{ type: 'text' as const, text: envelopeToText(env) }],
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return {
          content: [{ type: 'text' as const, text: `搜索失败：${message}` }],
          isError: true,
        }
      }
    },
  )

  server.registerTool(
    'read_page',
    {
      title: 'Read Page',
      description:
        '抓取单个网页。优先 ModSearch；失败时用 HTTP 去标签纯文本兜底（非 DuckDuckGo）。' +
        '可附带 query 作为提取关注点。返回 JSON。',
      inputSchema: {
        url: z.string().describe('要抓取的 URL'),
        query: z
          .string()
          .optional()
          .describe('可选：关注点 / 想从页面提取的问题'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ url, query }) => {
      try {
        const env = await readPage({
          url,
          query,
          timeoutMs,
          fallback,
        })
        return {
          content: [{ type: 'text' as const, text: envelopeToText(env) }],
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return {
          content: [{ type: 'text' as const, text: `抓取失败：${message}` }],
          isError: true,
        }
      }
    },
  )

  return server
}

export async function startModsearchServer(
  options: CreateModsearchServerOptions = {},
): Promise<void> {
  const server = createModsearchMcpServer(options)
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
