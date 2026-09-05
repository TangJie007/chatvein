import { resolve } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { ensureTrustedPackages } from './install'
import {
  listWorkspaceScripts,
  runJsInVm2,
  runJsResultToText,
  runWorkspaceScript,
} from './run'
import {
  checkPackagesTrust,
  DEFAULT_TRUST_POLICY,
  TRUSTED_PACKAGE_ALLOWLIST,
} from './trust'

export interface CreateVmsandboxServerOptions {
  workspaceRoot: string
  timeoutMs?: number
  maxOutputChars?: number
  scriptsOnly?: boolean
  /** 周下载量门槛；默认 1_000_000 */
  minWeeklyDownloads?: number
}

export function createVmsandboxMcpServer(
  options: CreateVmsandboxServerOptions,
): McpServer {
  const workspaceRoot = resolve(options.workspaceRoot.trim())
  if (!workspaceRoot) {
    throw new Error('createVmsandboxMcpServer: workspaceRoot 不能为空')
  }
  const defaultTimeoutMs = options.timeoutMs ?? 5_000
  const defaultMaxOutput = options.maxOutputChars ?? 8_000
  const scriptsOnly = options.scriptsOnly !== false
  const trustPolicy = {
    ...DEFAULT_TRUST_POLICY,
    minWeeklyDownloads:
      options.minWeeklyDownloads ?? DEFAULT_TRUST_POLICY.minWeeklyDownloads,
  }

  const server = new McpServer({
    name: 'chatvein-vmsandbox',
    version: '0.3.0',
  })

  server.registerTool(
    'run_workspace_script',
    {
      title: 'Run Workspace Script (NodeVM)',
      description:
        '用 vm2 NodeVM 执行工作区脚本（默认 `scripts/**`）。可 `require()` 工作区 `node_modules` 中已安装的包；' +
        '禁止 fs/net/child_process 等危险 builtin。' +
        '依赖请先 `ensure_trusted_packages`。返回 module.exports 的 JSON。',
      inputSchema: {
        path: z.string().describe('相对工作区路径，例如 scripts/summarize.js'),
        timeoutMs: z.number().int().min(50).max(30_000).optional(),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
        destructiveHint: false,
      },
    },
    async ({ path, timeoutMs }) => {
      const result = await runWorkspaceScript({
        workspaceRoot,
        path,
        scriptsOnly,
        timeoutMs: timeoutMs ?? defaultTimeoutMs,
        maxOutputChars: defaultMaxOutput,
      })
      return {
        content: [{ type: 'text' as const, text: runJsResultToText(result) }],
        isError: !result.ok,
      }
    },
  )

  server.registerTool(
    'list_workspace_scripts',
    {
      title: 'List Workspace Scripts',
      description: '列出工作区 `scripts/` 下 .js/.cjs/.mjs。',
      inputSchema: {
        subdir: z.string().optional().describe('子目录，默认 scripts'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ subdir }) => {
      const listed = await listWorkspaceScripts(
        workspaceRoot,
        subdir?.trim() || 'scripts',
      )
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(listed, null, 2) }],
        isError: Boolean(listed.error),
      }
    },
  )

  server.registerTool(
    'ensure_trusted_packages',
    {
      title: 'Ensure Trusted Packages',
      description:
        '校验并安装 npm 包到工作区。仅允许：硬白名单，或 npm 近一周下载量 ≥ 门槛（默认 100 万）。' +
        '禁止 git/file/URL。安装使用 `npm install --ignore-scripts`。',
      inputSchema: {
        packages: z
          .array(z.string())
          .min(1)
          .max(20)
          .describe('包名列表，如 ["lodash","dayjs"]（可带 @version）'),
      },
      annotations: {
        readOnlyHint: false,
        openWorldHint: true,
        destructiveHint: false,
      },
    },
    async ({ packages }) => {
      const result = await ensureTrustedPackages({
        workspaceRoot,
        packages,
        policy: trustPolicy,
      })
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      }
    },
  )

  server.registerTool(
    'check_package_trust',
    {
      title: 'Check Package Trust',
      description:
        '只校验、不安装。返回每个包是否可信及原因（白名单 / 周下载量）。' +
        `内置白名单约 ${TRUSTED_PACKAGE_ALLOWLIST.size} 个常用包。`,
      inputSchema: {
        packages: z.array(z.string()).min(1).max(20),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ packages }) => {
      const results = await checkPackagesTrust(packages, trustPolicy)
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              { minWeeklyDownloads: trustPolicy.minWeeklyDownloads, results },
              null,
              2,
            ),
          },
        ],
      }
    },
  )

  server.registerTool(
    'run_js',
    {
      title: 'Run Inline JS (VM)',
      description:
        '内联短 JS，**无 require**。需要依赖时请写到 scripts/ 并用 run_workspace_script。',
      inputSchema: {
        code: z.string(),
        timeoutMs: z.number().int().min(50).max(30_000).optional(),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
        destructiveHint: false,
      },
    },
    async ({ code, timeoutMs }) => {
      const result = runJsInVm2({
        code,
        timeoutMs: timeoutMs ?? defaultTimeoutMs,
        maxOutputChars: defaultMaxOutput,
      })
      return {
        content: [{ type: 'text' as const, text: runJsResultToText(result) }],
        isError: !result.ok,
      }
    },
  )

  return server
}

export async function startVmsandboxServer(
  options: CreateVmsandboxServerOptions,
): Promise<void> {
  const server = createVmsandboxMcpServer(options)
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
