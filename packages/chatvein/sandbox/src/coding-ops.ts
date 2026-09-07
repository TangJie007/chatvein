/**
 * 工作区编码原语（读/写/精确 patch）：供 Forge LangChain 工具与 MCP sandbox 共用。
 * 不含 LangChain / MCP SDK，保持 @chatvein/sandbox 纯 Node。
 */
import { readFile, writeFile as fsWriteFile, mkdir } from 'node:fs/promises'
import { basename, dirname, relative } from 'node:path'
import type { SandboxProvider } from './types'

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

const BLOCKED_SEGMENTS = [/\.pem$/i, /\.key$/i, /\.p12$/i, /\.pfx$/i]

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
 * - 默认要求 old_string 恰好出现 1 次；
 * - replaceAll 时替换全部出现。
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

/** 生成极简 unified hunk 摘要 */
export function summarizeReplaceDiff(
  before: string,
  _after: string,
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

export function relToWorkspace(sandbox: SandboxProvider, abs: string): string {
  const r = relative(sandbox.workspacePath, abs)
  return r === '' ? '.' : r
}

export async function readWorkspaceText(
  sandbox: SandboxProvider,
  path: string,
  opts?: { offset?: number; limit?: number },
): Promise<{ abs: string; rel: string; totalLines: number; text: string; range: string }> {
  assertNotSecretPath(path)
  const abs = sandbox.resolveInside(path)
  assertNotSecretPath(abs)
  const raw = await readFile(abs, 'utf8')
  const lines = raw.split(/\r?\n/)
  const start = opts?.offset ?? 0
  const end = opts?.limit ? start + opts.limit : lines.length
  const slice = lines.slice(start, end)
  return {
    abs,
    rel: relToWorkspace(sandbox, abs),
    totalLines: lines.length,
    text: slice.join('\n'),
    range: `${start + 1}-${Math.min(end, lines.length)}`,
  }
}

export async function writeWorkspaceText(
  sandbox: SandboxProvider,
  path: string,
  content: string,
): Promise<{ abs: string; rel: string; lines: number; chars: number }> {
  assertNotSecretPath(path)
  const abs = sandbox.resolveInside(path)
  assertNotSecretPath(abs)
  await mkdir(dirname(abs), { recursive: true })
  await fsWriteFile(abs, content, 'utf8')
  return {
    abs,
    rel: relToWorkspace(sandbox, abs),
    lines: content.split(/\r?\n/).length,
    chars: content.length,
  }
}

export async function applyWorkspacePatch(
  sandbox: SandboxProvider,
  path: string,
  oldString: string,
  newString: string,
  replaceAll = false,
): Promise<{ abs: string; rel: string; count: number; diff: string }> {
  assertNotSecretPath(path)
  const abs = sandbox.resolveInside(path)
  assertNotSecretPath(abs)
  const before = await readFile(abs, 'utf8')
  const { next, count } = applyExactReplace(before, oldString, newString, replaceAll)
  await fsWriteFile(abs, next, 'utf8')
  return {
    abs,
    rel: relToWorkspace(sandbox, abs),
    count,
    diff: summarizeReplaceDiff(before, next, oldString, newString),
  }
}

/** 极简 argv 切分（支持双引号） */
export function splitArgv(command: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(command))) {
    out.push(m[1] ?? m[2]!)
  }
  return out
}
