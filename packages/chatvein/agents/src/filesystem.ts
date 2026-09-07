/**
 * 统一文件工具：deepagents `createFilesystemMiddleware` + `StateBackend`。
 * 主 Agent（办公 ReAct）与编程 Agent（Forge implement/fix）共用同一套中间件。
 *
 * StateBackend 把文件存在 LangGraph state.files（随 checkpoint）；需要落盘产物 /
 * verify 时用 seed/flush 与真实工作区同步。
 */
import { readdir, readFile, mkdir, writeFile, stat } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import {
  createFilesystemMiddleware,
  StateBackend,
  type FileData,
  type FilesystemMiddlewareOptions,
  type FsToolName,
} from 'deepagents'

/** 暴露给模型的文件系统工具（不含 execute；shell/git 仍走沙箱工具） */
export const CHATVEIN_FS_TOOL_NAMES = [
  'ls',
  'read_file',
  'write_file',
  'edit_file',
  'glob',
  'grep',
] as const satisfies readonly FsToolName[]

export type ChatveinFsToolName = (typeof CHATVEIN_FS_TOOL_NAMES)[number]

/** deepagents state.files 记录（路径 → FileData） */
export type FilesRecord = Record<string, FileData>

/** 敏感路径 deny（与 sandbox coding-ops 对齐的 basename 级保护） */
export const CHATVEIN_FS_DENY_PERMISSIONS: NonNullable<FilesystemMiddlewareOptions['permissions']> =
  [
    {
      operations: ['read', 'write'],
      paths: [
        '/**/.env',
        '/**/.env.*',
        '/**/credentials.json',
        '/**/credentials.csv',
        '/**/secrets.json',
        '/**/secret.json',
        '/**/id_rsa',
        '/**/id_ed25519',
        '/**/id_ecdsa',
        '/**/*.pem',
        '/**/*.key',
        '/**/*.p12',
        '/**/*.pfx',
      ],
      mode: 'deny',
    },
  ]

/**
 * 创建挂在 createAgent.middleware 上的文件系统中间件。
 * 默认 `new StateBackend()`；禁止 execute（执行仍用 LocalSandbox / mcp_shellsandbox）。
 */
export function createStateFilesystemMiddleware(
  options: Omit<FilesystemMiddlewareOptions, 'backend'> & {
    /** 覆盖工具白名单；默认 CHATVEIN_FS_TOOL_NAMES */
    tools?: readonly FsToolName[] | 'all' | null
  } = {},
) {
  const { tools = CHATVEIN_FS_TOOL_NAMES, permissions, ...rest } = options
  return createFilesystemMiddleware({
    ...rest,
    backend: new StateBackend(),
    tools,
    permissions: permissions ?? CHATVEIN_FS_DENY_PERMISSIONS,
  })
}

/** 文本 → deepagents FileData（v2） */
export function textToFileData(content: string, mimeType = 'text/plain'): FileData {
  const now = new Date().toISOString()
  return { content, mimeType, created_at: now, modified_at: now }
}

/** FileData → 文本；二进制或缺失返回 null */
export function fileDataToText(data: FileData | null | undefined): string | null {
  if (!data) return null
  if (typeof data.content === 'string') return data.content
  if (Array.isArray(data.content)) return data.content.join('\n')
  return null
}

/** 相对路径 → StateBackend 绝对虚路径（`/src/a.ts`） */
export function toVirtualPath(relOrVirtual: string): string {
  const norm = relOrVirtual.replace(/\\/g, '/').replace(/^\.\//, '')
  if (norm.startsWith('/')) return norm
  return `/${norm.replace(/^\/+/, '')}`
}

/** 虚路径 → 相对工作区路径 */
export function toRelativePath(virtualPath: string): string {
  return virtualPath.replace(/\\/g, '/').replace(/^\/+/, '')
}

const DEFAULT_SEED_SKIP_DIR = new Set([
  'node_modules',
  '.git',
  'dist',
  'out',
  'build',
  '.next',
  'coverage',
  '.turbo',
  '.cache',
])

export interface SeedFilesOptions {
  /** 最多收录文件数（默认 400） */
  maxFiles?: number
  /** 单文件最大字节（默认 256 KiB） */
  maxFileBytes?: number
  /** 跳过的目录名 */
  skipDirNames?: Set<string>
}

/**
 * 从磁盘工作区种子化 StateBackend `files`（跳过依赖/构建目录与过大文件）。
 * 路径键为虚路径 `/rel`。
 */
export async function seedFilesFromDisk(
  rootDir: string,
  options: SeedFilesOptions = {},
): Promise<FilesRecord> {
  const maxFiles = options.maxFiles ?? 400
  const maxFileBytes = options.maxFileBytes ?? 256 * 1024
  const skip = options.skipDirNames ?? DEFAULT_SEED_SKIP_DIR
  const files: FilesRecord = {}
  let count = 0

  async function walk(absDir: string): Promise<void> {
    if (count >= maxFiles) return
    let entries
    try {
      entries = await readdir(absDir, { withFileTypes: true })
    } catch {
      return
    }
    for (const ent of entries) {
      if (count >= maxFiles) return
      const name = ent.name
      if (name === '.' || name === '..') continue
      if (ent.isDirectory()) {
        if (skip.has(name) || name.startsWith('.')) continue
        await walk(join(absDir, name))
        continue
      }
      if (!ent.isFile()) continue
      const abs = join(absDir, name)
      let st
      try {
        st = await stat(abs)
      } catch {
        continue
      }
      if (st.size > maxFileBytes) continue
      const rel = relative(rootDir, abs).split(sep).join('/')
      if (!rel || rel.startsWith('..')) continue
      try {
        const text = await readFile(abs, 'utf8')
        // 粗略跳过明显二进制
        if (text.includes('\u0000')) continue
        files[toVirtualPath(rel)] = textToFileData(text)
        count++
      } catch {
        // 编码失败等：跳过
      }
    }
  }

  await walk(rootDir)
  return files
}

/**
 * 把 StateBackend `files` 刷回磁盘工作区。
 * @returns 实际写入的相对路径列表
 */
export async function flushFilesToDisk(
  rootDir: string,
  files: FilesRecord | null | undefined,
): Promise<string[]> {
  if (!files) return []
  const written: string[] = []
  for (const [virtualPath, data] of Object.entries(files)) {
    if (data == null) continue
    const text = fileDataToText(data)
    if (text == null) continue
    const rel = toRelativePath(virtualPath)
    if (!rel || rel.includes('..')) continue
    const abs = join(rootDir, rel)
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, text, 'utf8')
    written.push(rel)
  }
  return written
}
