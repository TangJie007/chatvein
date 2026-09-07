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
import { basename, dirname, relative } from 'node:path'
import type { SandboxProvider } from '@chatvein/sandbox'
import { truncateFolded } from '@chatvein/context'

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

/** 禁止读写的敏感文件名（basename 匹配，大小写不敏感） */
const BLOCKED_BASENAMES = new Set([
  '.env',
  '.env.local',
  '.env.development',
  '.env.production',
  '.env.test',
  '.env.staging',
  'credentials.json',
  'credentials.csv',
  'secrets.json',
  'secret.json',
  'id_rsa',
  'id_ed25519',
  'id_ecdsa',
])

/** 路径段命中即拒绝（相对路径任意层级） */
const BLOCKED_SEGMENTS = [/\.pem$/i, /\.key$/i, /\.p12$/i, /\.pfx$/i]

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
interface ApplyPatchInput {
  path: string
  old_string: string
  new_string: string
  /** 为 true 时替换全部匹配；默认仅允许恰好 1 处 */
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

/** 把相对/绝对路径规整为 workspace 内绝对路径 */
function resolvePath(sandbox: SandboxProvider, p: string): string {
  return sandbox.resolveInside(p)
}

function rel(sandbox: SandboxProvider, abs: string): string {
  const r = relative(sandbox.workspacePath, abs)
  return r === '' ? '.' : r
}

/** 敏感路径拒绝（.env / 密钥文件等） */
export function assertNotSecretPath(relOrAbs: string): void {
  const norm = relOrAbs.replace(/\\/g, '/')
  const base = basename(norm).toLowerCase()
  if (BLOCKED_BASENAMES.has(base) || base.startsWith('.env.')) {
    throw new Error(`出于安全考虑，禁止读写敏感文件：${base}`)
  }
  for (const re of BLOCKED_SEGMENTS) {
    if (re.test(base)) {
      throw new Error(`出于安全考虑，禁止读写敏感文件：${base}`)
    }
  }
}

/**
 * 精确字符串替换（search-replace）。
 * - 默认要求 old_string 在文件中恰好出现 1 次；
 * - replaceAll 时替换全部出现；
 * - old === new 拒绝（无意义调用）。
 */
export function applyExactReplace(
  content: string,
  oldString: string,
  newString: string,
  replaceAll = false,
): { next: string; count: number } {
  if (!oldString) {
    throw new Error('old_string 不能为空')
  }
  if (oldString === newString) {
    throw new Error('old_string 与 new_string 相同，无需修改')
  }
  const count = countOccurrences(content, oldString)
  if (count === 0) {
    throw new Error(
      'old_string 未在文件中找到。请先 read_file 核对原文（含缩进/换行），再缩小唯一匹配片段。',
    )
  }
  if (!replaceAll && count > 1) {
    throw new Error(
      `old_string 匹配 ${count} 处；请扩大上下文使匹配唯一，或设 replace_all=true 全部替换。`,
    )
  }
  const next = replaceAll
    ? content.split(oldString).join(newString)
    : content.replace(oldString, newString)
  return { next, count: replaceAll ? count : 1 }
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  let n = 0
  let from = 0
  while (from <= haystack.length) {
    const i = haystack.indexOf(needle, from)
    if (i < 0) break
    n++
    from = i + needle.length
  }
  return n
}

/** 生成极简 unified hunk 摘要（前后各留少量上下文），便于模型确认 */
export function summarizeReplaceDiff(
  before: string,
  after: string,
  oldString: string,
  newString: string,
  maxContextLines = 2,
): string {
  const beforeLines = before.split(/\r?\n/)
  const idx = before.indexOf(oldString)
  if (idx < 0) return `(已替换 ${oldString.length}→${newString.length} 字符)`
  const lineStart = before.slice(0, idx).split(/\r?\n/).length - 1
  const oldLineCount = oldString.split(/\r?\n/).length
  const newLines = newString.split(/\r?\n/)
  const ctxBefore = beforeLines.slice(Math.max(0, lineStart - maxContextLines), lineStart)
  const ctxAfter = beforeLines.slice(
    lineStart + oldLineCount,
    lineStart + oldLineCount + maxContextLines,
  )
  const hunk = [
    ...ctxBefore.map((l) => ` ${l}`),
    ...oldString.split(/\r?\n/).map((l) => `-${l}`),
    ...newLines.map((l) => `+${l}`),
    ...ctxAfter.map((l) => ` ${l}`),
  ]
  return `@@ ~L${lineStart + 1} @@\n${hunk.join('\n')}`
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
      assertNotSecretPath(input.path)
      const abs = resolvePath(sandbox, input.path)
      assertNotSecretPath(abs)
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
      assertNotSecretPath(input.path)
      const abs = resolvePath(sandbox, input.path)
      assertNotSecretPath(abs)
      await mkdir(dirname(abs), { recursive: true })
      await fsWriteFile(abs, input.content, 'utf8')
      const lines = input.content.split(/\r?\n/).length
      return `已写入 ${rel(sandbox, abs)}（${lines} 行，${input.content.length} 字符）`
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
      assertNotSecretPath(input.path)
      const abs = resolvePath(sandbox, input.path)
      assertNotSecretPath(abs)
      const before = await readFile(abs, 'utf8')
      const { next, count } = applyExactReplace(
        before,
        input.old_string,
        input.new_string,
        input.replace_all === true,
      )
      await fsWriteFile(abs, next, 'utf8')
      const diff = summarizeReplaceDiff(before, next, input.old_string, input.new_string)
      const r = truncateFolded(diff, budget)
      return `已 patch ${rel(sandbox, abs)}（替换 ${count} 处）\n${r.text}`
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
