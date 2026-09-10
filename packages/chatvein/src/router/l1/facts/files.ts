/**
 * 文件 / 附件信号。扩展名分类借助 `mime-types`。
 */
import { extname } from 'node:path'
import { lookup } from 'mime-types'

const PATH_RE =
  /(?:[A-Za-z]:\\|\/|\.\/|\.\.\/)[^\s*?"<>|\]]+|\b[\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|json|md|ya?ml|toml|css|vue|pdf|xlsx?|docx?|pptx?|csv|txt)(?::\d+(?::\d+)?)?\b/gi

const OFFICE_EXT = new Set([
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.csv',
  '.odt',
  '.ods',
])

const CODE_EXT = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.cs',
  '.cpp',
  '.h',
  '.vue',
  '.svelte',
  '.json',
  '.yml',
  '.yaml',
  '.toml',
  '.css',
  '.md',
])

const OFFICE_MIME = /^(application\/(pdf|msword|vnd\.|vnd\.openxmlformats)|text\/csv)/i

export interface FileFacts {
  paths: string[]
  extensions: string[]
  officeExt: boolean
  codeExt: boolean
  fromAttachments: boolean
}

function normalizeExt(nameOrPath: string): string {
  // 去掉 path:line / path:line:col 后缀再取扩展名
  const cleaned = nameOrPath.replace(/:\d+(?::\d+)?$/, '')
  return extname(cleaned).toLowerCase()
}

function isOfficeExt(ext: string, mime?: string): boolean {
  if (OFFICE_EXT.has(ext)) return true
  if (mime && OFFICE_MIME.test(mime)) return true
  if (!mime && ext) {
    const guessed = lookup(ext.slice(1) || ext)
    if (typeof guessed === 'string' && OFFICE_MIME.test(guessed)) return true
  }
  return false
}

function isCodeExt(ext: string): boolean {
  return CODE_EXT.has(ext)
}

export function extractFileFacts(
  text: string,
  attachments?: Array<{ name: string; mime?: string }>,
): FileFacts {
  const paths = [...new Set([...text.matchAll(PATH_RE)].map((m) => m[0]))]
  const extensions = new Set<string>()
  let officeExt = false
  let codeExt = false
  let fromAttachments = false

  for (const p of paths) {
    const ext = normalizeExt(p)
    if (!ext) continue
    extensions.add(ext)
    if (isOfficeExt(ext)) officeExt = true
    if (isCodeExt(ext)) codeExt = true
  }

  for (const a of attachments ?? []) {
    fromAttachments = true
    const ext = normalizeExt(a.name)
    if (ext) extensions.add(ext)
    const mime = a.mime || (ext ? lookup(ext.slice(1)) || undefined : undefined)
    if (isOfficeExt(ext, typeof mime === 'string' ? mime : undefined)) officeExt = true
    if (isCodeExt(ext)) codeExt = true
  }

  return {
    paths,
    extensions: [...extensions],
    officeExt,
    codeExt,
    fromAttachments,
  }
}
