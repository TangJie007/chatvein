/**
 * Forge 编码工具层（implement/fix 节点绑定给内层 ReAct agent）。
 *
 * 与 Chat 轨 @chatvein/tools（MCP 对话工具目录）物理隔离：
 * 这里的工具全部经 SandboxProvider 在隔离工作区内执行，带路径 jail、
 * 命令白名单、超时与输出截断。每个工具返回字符串（LangChain tool 约定）。
 */
import { z } from 'zod'
import { tool, type StructuredToolInterface } from '@langchain/core/tools'
import { readFile, writeFile as fsWriteFile, mkdir } from 'node:fs/promises'
import { dirname, relative } from 'node:path'
import type { SandboxProvider } from '@chatvein/sandbox'
import { truncateFolded } from '@chatvein/context'

export interface ForgeToolsDeps {
  sandbox: SandboxProvider
  /** 工具输出进上下文前的 token 预算（截断） */
  outputTokenBudget?: number
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

/** 各工具输入类型（与 zod schema 对齐） */
interface ReadFileInput {
  path: string
  offset?: number
  limit?: number
}
interface WriteFileInput {
  path: string
  content: string
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

/** 把相对/绝对路径规整为 workspace 内绝对路径 */
function resolvePath(sandbox: SandboxProvider, p: string): string {
  return sandbox.resolveInside(p)
}

function rel(sandbox: SandboxProvider, abs: string): string {
  const r = relative(sandbox.workspacePath, abs)
  return r === '' ? '.' : r
}

/** 构造全套 Forge 编码工具 */
export function createForgeTools(deps: ForgeToolsDeps): StructuredToolInterface[] {
  const { sandbox } = deps
  const budget = deps.outputTokenBudget ?? DEFAULT_BUDGET
  const trace = deps.onToolCall ?? (() => {})

  /** 给工具函数包一层 trace 计时与错误留痕 */
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
      const abs = resolvePath(sandbox, input.path)
      const raw = await readFile(abs, 'utf8')
      const lines = raw.split(/\r?\n/)
      const start = input.offset ?? 0
      const end = input.limit ? start + input.limit : lines.length
      const slice = lines.slice(start, end)
      const text = slice.join('\n')
      const r = truncateFolded(text, budget)
      return `文件 ${rel(sandbox, abs)}（${lines.length} 行，显示 ${start + 1}-${Math.min(end, lines.length)}）\n${r.text}`
    }),
    {
      name: 'read_file',
      description:
        '读取工作区内文件内容（UTF-8 文本）。可指定 offset 起始行(0-based)与 limit 行数。路径相对工作区根。',
      schema: z.object({
        path: z.string().describe('文件路径，相对工作区根'),
        offset: z.number().int().nonnegative().optional().describe('起始行号(0-based)'),
        limit: z.number().int().positive().optional().describe('读取行数'),
      }),
    },
  )

  const write_file = tool(
    withTrace<WriteFileInput, string>('write_file', async (input) => {
      const abs = resolvePath(sandbox, input.path)
      await mkdir(dirname(abs), { recursive: true })
      await fsWriteFile(abs, input.content, 'utf8')
      const lines = input.content.split(/\r?\n/).length
      return `已写入 ${rel(sandbox, abs)}（${lines} 行，${input.content.length} 字符）`
    }),
    {
      name: 'write_file',
      description:
        '全量写入/覆盖工作区内文件（自动创建父目录）。优先用于新建文件；修改已有文件优先用 apply_patch 做最小改动。',
      schema: z.object({
        path: z.string().describe('文件路径，相对工作区根'),
        content: z.string().describe('完整文件内容'),
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
      const res = await sandbox.exec({ argv, timeoutMs: 30_000 })
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

  return [read_file, write_file, list_dir, exec_shell, git_op]
}

/** 极简 argv 切分（支持双引号包裹）；沙箱内命令简单，不做完整 shell 解析 */
function splitArgv(command: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(command))) {
    out.push(m[1] ?? m[2]!)
  }
  return out
}
