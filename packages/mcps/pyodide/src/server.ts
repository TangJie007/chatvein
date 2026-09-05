import { resolve } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { ensureTrustedPackages } from './install'
import {
  listWorkspaceScripts,
  runPyInPyodide,
  runPyResultToText,
  runWorkspaceScript,
} from './run'
import {
  checkPackagesTrust,
  DEFAULT_TRUST_POLICY,
  TRUSTED_PACKAGE_ALLOWLIST,
} from './trust'

export interface CreatePyodideServerOptions {
  workspaceRoot: string
  timeoutMs?: number
  maxOutputChars?: number
  scriptsOnly?: boolean
  minWeeklyDownloads?: number
}

export function createPyodideMcpServer(options: CreatePyodideServerOptions): McpServer {
  const workspaceRoot = resolve(options.workspaceRoot.trim())
  if (!workspaceRoot) {
    throw new Error('createPyodideMcpServer: workspaceRoot 不能为空')
  }
  const defaultTimeoutMs = options.timeoutMs ?? 15_000
  const defaultMaxOutput = options.maxOutputChars ?? 8_000
  const scriptsOnly = options.scriptsOnly !== false
  const trustPolicy = {
    ...DEFAULT_TRUST_POLICY,
    minWeeklyDownloads:
      options.minWeeklyDownloads ?? DEFAULT_TRUST_POLICY.minWeeklyDownloads,
  }

  const server = new McpServer({
    name: 'chatvein-pyodide',
    version: '0.1.0',
  })

  server.registerTool(
    'run_workspace_script',
    {
      title: 'Run Workspace Python Script (Pyodide)',
      description:
        '用 Pyodide（WASM Python）执行工作区脚本（默认 `scripts/**/*.py`）。' +
        '依赖请先 `ensure_trusted_packages`。返回最后表达式结果与 stdout。',
      inputSchema: {
        path: z.string().describe('相对工作区路径，例如 scripts/analyze.py'),
        timeoutMs: z.number().int().min(100).max(120_000).optional(),
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
        content: [{ type: 'text' as const, text: runPyResultToText(result) }],
        isError: !result.ok,
      }
    },
  )

  server.registerTool(
    'list_workspace_scripts',
    {
      title: 'List Workspace Python Scripts',
      description: '列出工作区 `scripts/` 下 `.py`。',
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
        '校验并安装到当前 Pyodide 运行时。仅允许：硬白名单，或 PyPI 近一周下载量 ≥ 门槛（默认 100 万）。' +
        '优先 `loadPackage`，否则 `micropip.install`。禁止 git/file/URL。',
      inputSchema: {
        packages: z
          .array(z.string())
          .min(1)
          .max(20)
          .describe('包名列表，如 ["numpy","pandas"]'),
      },
      annotations: {
        readOnlyHint: false,
        openWorldHint: true,
        destructiveHint: false,
      },
    },
    async ({ packages }) => {
      const result = await ensureTrustedPackages({
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
        '只校验、不安装。返回每个包是否可信及原因（白名单 / PyPI 周下载量）。' +
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
    'run_py',
    {
      title: 'Run Inline Python (Pyodide)',
      description:
        '内联短 Python。需要复杂依赖或可复用逻辑时请写到 `scripts/` 并用 `run_workspace_script`。',
      inputSchema: {
        code: z.string(),
        timeoutMs: z.number().int().min(100).max(120_000).optional(),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
        destructiveHint: false,
      },
    },
    async ({ code, timeoutMs }) => {
      const result = await runPyInPyodide({
        code,
        timeoutMs: timeoutMs ?? defaultTimeoutMs,
        maxOutputChars: defaultMaxOutput,
      })
      return {
        content: [{ type: 'text' as const, text: runPyResultToText(result) }],
        isError: !result.ok,
      }
    },
  )

  return server
}

export async function startPyodideServer(
  options: CreatePyodideServerOptions,
): Promise<void> {
  const server = createPyodideMcpServer(options)
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
