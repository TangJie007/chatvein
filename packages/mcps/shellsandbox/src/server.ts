import { resolve } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { LocalSandboxProvider, splitArgv } from '@chatvein/sandbox'

export interface CreateShellsandboxServerOptions {
  workspaceRoot: string
  /** exec 默认超时 */
  defaultTimeoutMs?: number
}

/**
 * 工作区 shell/git MCP：读写文件请用 deepagents StateBackend middleware（ls / read_file / write_file / edit_file）。
 * 本 server 只暴露 LocalSandboxProvider 白名单命令能力。
 */
export function createShellsandboxMcpServer(options: CreateShellsandboxServerOptions): McpServer {
  const workspaceRoot = resolve(options.workspaceRoot.trim())
  if (!workspaceRoot) {
    throw new Error('createShellsandboxMcpServer: workspaceRoot 不能为空')
  }
  const defaultTimeoutMs = options.defaultTimeoutMs ?? 300_000
  const sandbox = new LocalSandboxProvider({ workspacePath: workspaceRoot })

  const server = new McpServer({
    name: 'chatvein-shellsandbox',
    version: '0.1.0',
  })

  server.registerTool(
    'exec_shell',
    {
      title: 'Exec Shell',
      description:
        '在工作区执行白名单命令（npm/pnpm/node/git/npx/tsc/vitest/jest 等）。用于构建与测试。',
      inputSchema: {
        command: z.string().describe('如 "npm test"'),
        cwd: z.string().optional(),
        timeoutMs: z.number().int().positive().optional(),
      },
      annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: true },
    },
    async ({ command, cwd, timeoutMs }) => {
      try {
        const res = await sandbox.exec({
          argv: splitArgv(command),
          cwd,
          timeoutMs: timeoutMs ?? defaultTimeoutMs,
        })
        const out = [res.stdout, res.stderr].filter(Boolean).join('\n')
        const body = res.rejected
          ? `[拒绝] ${res.rejected}`
          : out || `(exit ${res.code}，无输出)`
        return {
          content: [
            {
              type: 'text' as const,
              text: `$ ${res.command}\nexit=${res.code ?? 'killed'}${res.truncated ? '（输出已截断）' : ''}\n${body}`,
            },
          ],
          isError: Boolean(res.rejected) || (res.code !== 0 && res.code != null),
        }
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: (err as Error).message }],
          isError: true,
        }
      }
    },
  )

  server.registerTool(
    'git_op',
    {
      title: 'Git Op',
      description: '在工作区执行 git（status/add/commit/diff/log/init）。args 为子命令及参数。',
      inputSchema: {
        args: z.string().describe('如 "status" 或 "diff --stat"'),
      },
      annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
    },
    async ({ args }) => {
      try {
        const res = await sandbox.exec({
          argv: ['git', ...splitArgv(args)],
          timeoutMs: 30_000,
        })
        const out = [res.stdout, res.stderr].filter(Boolean).join('\n')
        const text = res.rejected
          ? `[拒绝] ${res.rejected}`
          : out || `(exit ${res.code})`
        return {
          content: [{ type: 'text' as const, text }],
          isError: Boolean(res.rejected) || (res.code !== 0 && res.code != null),
        }
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: (err as Error).message }],
          isError: true,
        }
      }
    },
  )

  return server
}

export async function startShellsandboxServer(
  options: CreateShellsandboxServerOptions,
): Promise<void> {
  await new LocalSandboxProvider({ workspacePath: resolve(options.workspaceRoot) }).prepare()
  const server = createShellsandboxMcpServer(options)
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
