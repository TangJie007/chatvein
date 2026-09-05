import { resolve } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { openFolderPath } from './open'

export interface CreateOpenfileServerOptions {
  /** CLI 传入的允许根目录；空 = 不限制 */
  allowedDirectories?: string[]
}

export function createOpenfileMcpServer(
  options: CreateOpenfileServerOptions = {},
): McpServer {
  const allowedDirectories = (options.allowedDirectories ?? [])
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => resolve(d))

  const server = new McpServer({
    name: 'chatvein-openfile',
    version: '0.1.0',
  })

  server.registerTool(
    'open_folder',
    {
      title: 'Open Folder',
      description:
        '在系统文件管理器中打开文件夹。若 path 指向文件，则打开该文件所在的文件夹。' +
        (allowedDirectories.length > 0
          ? ' 仅允许在已配置的工作区目录内操作。'
          : ''),
      inputSchema: {
        path: z
          .string()
          .describe('要打开的文件夹路径，或任意文件路径（将打开其父目录）'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ path: inputPath }) => {
      try {
        const result = await openFolderPath(inputPath, allowedDirectories)
        return {
          content: [{ type: 'text' as const, text: result.message }],
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return {
          content: [{ type: 'text' as const, text: `打开失败：${message}` }],
          isError: true,
        }
      }
    },
  )

  server.registerTool(
    'list_allowed_directories',
    {
      title: 'List Allowed Directories',
      description: '列出本 MCP 允许打开的根目录；空列表表示未启用路径限制。',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const text =
        allowedDirectories.length === 0
          ? '未配置允许目录（可打开任意已存在路径）。'
          : allowedDirectories.map((d) => `- ${d}`).join('\n')
      return {
        content: [{ type: 'text' as const, text }],
      }
    },
  )

  return server
}

/** stdio 传输启动（MCP 子进程入口） */
export async function startOpenfileServer(
  allowedDirectories: string[] = [],
): Promise<void> {
  const server = createOpenfileMcpServer({ allowedDirectories })
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
