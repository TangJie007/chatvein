/**
 * Forge 执行工具层（implement/fix 节点绑定给内层 ReAct agent）。
 *
 * 文件读写已统一迁到 deepagents `createFilesystemMiddleware` + `StateBackend`
 *（见 `@chatvein/agents` createStateFilesystemMiddleware）；本模块只保留
 * 沙箱白名单 `exec_shell` / `git_op`。
 */
import { z } from 'zod'
import { tool, type StructuredToolInterface } from '@langchain/core/tools'
import type { SandboxProvider } from '@chatvein/sandbox'
import { splitArgv } from '@chatvein/sandbox'
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

interface ExecShellInput {
  command: string
  cwd?: string
  timeoutMs?: number
}
interface GitOpInput {
  args: string
}

/** 构造 Forge 执行工具（仅 shell/git；文件走 StateBackend middleware） */
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

  return [exec_shell, git_op]
}
