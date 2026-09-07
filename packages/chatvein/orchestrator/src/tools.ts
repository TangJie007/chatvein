/**
 * Forge 编码工具层（implement/fix 节点绑定给内层 ReAct agent）。
 *
 * 读写/patch 原语来自 `@chatvein/sandbox` coding-ops（进程内 LangChain 包装）。
 * Chat 轨文件读写走官方 MCP filesystem；白名单 shell/git 走 `mcp_shellsandbox`。
 */
import { z } from 'zod'
import { tool, type StructuredToolInterface } from '@langchain/core/tools'
import type { SandboxProvider } from '@chatvein/sandbox'
import {
  applyWorkspacePatch,
  readWorkspaceText,
  splitArgv,
  writeWorkspaceText,
} from '@chatvein/sandbox'
import { truncateFolded } from '@chatvein/context'

/** 兼容旧 import；新代码请从 `@chatvein/sandbox` 导入 */
export {
  assertNotSecretPath,
  applyExactReplace,
  summarizeReplaceDiff,
} from '@chatvein/sandbox'

export interface ForgeToolsDeps {
  sandbox: SandboxProvider
  /** 工具输出进上下文前的 token 预算（截断） */
  outputTokenBudget?: number
  /** 透传给 exec：用户取消时杀进程 */
  signal?: AbortSignal
  /** trace 回调：每次工具调用留痕 */
  onToolCall?: (info: {
    name: string
    argSize: number
    resultSize: number
    durationMs: number
    truncated: boolean
    error?: string
  }) => void | Promise<void>
}

const DEFAULT_BUDGET = 1200

interface ReadFileInput {
  path: string
  offset?: number
  limit?: number
}
interface WriteFileInput {
  path: string
  content: string
}
interface ApplyPatchInput {
  path: string
  old_string: string
  new_string: string
  replace_all?: boolean
}
interface ListDirInput {
  path?: string
}
interface ExecShellInput {
  command: string
  cwd?: string
  timeoutMs?: number
}
interface GitOpInput {
  args: string
}

/** 构造全套 Forge 编码工具（进程内；Chat shell 见 mcp_shellsandbox） */
export function createForgeTools(deps: ForgeToolsDeps): StructuredToolInterface[] {
  const { sandbox } = deps
  const budget = deps.outputTokenBudget ?? DEFAULT_BUDGET
  const trace = deps.onToolCall ?? (() => {})

  function withTrace<I, O extends string>(name: string, fn: (input: I) => Promise<O>) {
    return async (input: I): Promise<O> => {
      const started = Date.now()
      const argSize = JSON.stringify(input ?? {}).length
      try {
        const out = await fn(input)
        await trace({
          name,
          argSize,
          resultSize: out.length,
          durationMs: Date.now() - started,
          truncated: out.length > budget * 4,
        })
        return out
      } catch (err) {
        await trace({
          name,
          argSize,
          resultSize: 0,
          durationMs: Date.now() - started,
          truncated: false,
          error: (err as Error).message,
        })
        throw err
      }
    }
  }

  const read_file = tool(
    withTrace<ReadFileInput, string>('read_file', async (input) => {
      const r = await readWorkspaceText(sandbox, input.path, {
        offset: input.offset,
        limit: input.limit,
      })
      const folded = truncateFolded(r.text, budget)
      return `文件 ${r.rel}（${r.totalLines} 行，显示 ${r.range}）\n${folded.text}`
    }),
    {
      name: 'read_file',
      description:
        '读取工作区内文件内容（UTF-8 文本）。可指定 offset 起始行(0-based)与 limit 行数。路径相对工作区根。禁止读取 .env / 密钥类文件。',
      schema: z.object({
        path: z.string().describe('文件路径，相对工作区根'),
        offset: z.number().int().nonnegative().optional().describe('起始行号(0-based)'),
        limit: z.number().int().positive().optional().describe('读取行数'),
      }),
    },
  )

  const write_file = tool(
    withTrace<WriteFileInput, string>('write_file', async (input) => {
      const r = await writeWorkspaceText(sandbox, input.path, input.content)
      return `已写入 ${r.rel}（${r.lines} 行，${r.chars} 字符）`
    }),
    {
      name: 'write_file',
      description:
        '全量写入/覆盖工作区内文件（自动创建父目录）。仅用于新建文件或必须整文件重写；修改已有文件请用 apply_patch。禁止写入 .env / 密钥类文件。',
      schema: z.object({
        path: z.string().describe('文件路径，相对工作区根'),
        content: z.string().describe('完整文件内容'),
      }),
    },
  )

  const apply_patch = tool(
    withTrace<ApplyPatchInput, string>('apply_patch', async (input) => {
      const r = await applyWorkspacePatch(
        sandbox,
        input.path,
        input.old_string,
        input.new_string,
        input.replace_all === true,
      )
      const folded = truncateFolded(r.diff, budget)
      return `已 patch ${r.rel}（替换 ${r.count} 处）\n${folded.text}`
    }),
    {
      name: 'apply_patch',
      description:
        '对已有文件做精确 search-replace（最小改动）。old_string 须与文件原文完全一致（含缩进）；默认只允许匹配 1 处。优先于 write_file 修改已有代码。',
      schema: z.object({
        path: z.string().describe('文件路径，相对工作区根'),
        old_string: z.string().describe('要替换的原文片段（须唯一，除非 replace_all）'),
        new_string: z.string().describe('替换后的新文本（可为空字符串表示删除）'),
        replace_all: z
          .boolean()
          .optional()
          .describe('为 true 时替换全部匹配；默认 false（要求恰好 1 处）'),
      }),
    },
  )

  const list_dir = tool(
    withTrace<ListDirInput, string>('list_dir', async (input) => {
      const entries = await sandbox.list(input.path ?? '.')
      const text = entries.length ? entries.join('\n') : '(空目录)'
      return truncateFolded(text, budget).text
    }),
    {
      name: 'list_dir',
      description: '列出工作区内目录内容（目录以 / 结尾）。自动忽略 node_modules 与点开头的隐藏项。',
      schema: z.object({
        path: z.string().optional().describe('目录路径，相对工作区根；缺省为根'),
      }),
    },
  )

  const exec_shell = tool(
    withTrace<ExecShellInput, string>('exec_shell', async (input) => {
      const res = await sandbox.exec({
        argv: splitArgv(input.command),
        cwd: input.cwd,
        timeoutMs: input.timeoutMs ?? 300_000,
        signal: deps.signal,
      })
      const out = [res.stdout, res.stderr].filter(Boolean).join('\n')
      const body = res.rejected
        ? `[拒绝] ${res.rejected}`
        : truncateFolded(out || `(exit ${res.code}，无输出)`, budget).text
      return `$ ${res.command}\nexit=${res.code ?? 'killed'}${res.truncated ? '（输出已截断）' : ''}\n${body}`
    }),
    {
      name: 'exec_shell',
      description:
        '在工作区执行白名单命令（npm/pnpm/node/git/npx/tsc/vitest/jest 等）。用于安装依赖、构建、跑测试。命令以字符串给出，参数空格分隔。',
      schema: z.object({
        command: z.string().describe('命令行，如 "npm test" 或 "npx vitest run add.test.ts"'),
        cwd: z.string().optional().describe('相对工作区的子目录'),
        timeoutMs: z.number().int().positive().optional().describe('超时毫秒，默认 300000'),
      }),
    },
  )

  const git_op = tool(
    withTrace<GitOpInput, string>('git_op', async (input) => {
      const argv = ['git', ...splitArgv(input.args)]
      const res = await sandbox.exec({ argv, timeoutMs: 30_000, signal: deps.signal })
      const out = [res.stdout, res.stderr].filter(Boolean).join('\n')
      return res.rejected
        ? `[拒绝] ${res.rejected}`
        : truncateFolded(out || `(exit ${res.code})`, budget).text
    }),
    {
      name: 'git_op',
      description: '在工作区执行只读/提交类 git 操作（status/add/commit/diff/log/init）。args 为 git 子命令及参数。',
      schema: z.object({
        args: z.string().describe('git 参数，如 "init" 或 "add -A" 或 "commit -m msg"'),
      }),
    },
  )

  return [read_file, apply_patch, write_file, list_dir, exec_shell, git_op]
}
