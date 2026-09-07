/**
 * 统一文件工具：deepagents `createFilesystemMiddleware` + CompositeBackend。
 * 工具名 / 描述目录在 `@chatvein/tools`（state_filesystem）；本模块只装配 middleware。
 *
 * - default `StateBackend`：草稿 / 大 tool result 等内部路径（随 checkpoint）
 * - `/workspace/` → `FilesystemBackend`：工作区按需读盘、即时写盘（大仓无需 seed）
 */
import { readdir, readFile, mkdir, writeFile, stat } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import {
  STATE_FILESYSTEM_TOOL_NAMES,
  stateFilesystemCustomDescriptions,
  type StateFilesystemToolName,
} from '@chatvein/tools'
import {
  CompositeBackend,
  createFilesystemMiddleware,
  FilesystemBackend,
  StateBackend,
  type FileData,
  type FilesystemMiddlewareOptions,
  type FsToolName,
} from 'deepagents'

/** 与 `@chatvein/tools` STATE_FILESYSTEM_TOOL_NAMES 同值 */
export const CHATVEIN_FS_TOOL_NAMES = STATE_FILESYSTEM_TOOL_NAMES

export type ChatveinFsToolName = StateFilesystemToolName

/** Composite 路由：工作区虚路径前缀（须带尾斜杠） */
export const WORKSPACE_ROUTE_PREFIX = '/workspace/' as const

/** deepagents state.files 记录（路径 → FileData）；不含 `/workspace/` 下已落盘文件 */
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

export type CreateStateFilesystemMiddlewareOptions = Omit<
  FilesystemMiddlewareOptions,
  'backend'
> & {
  /** 工作区根目录：挂到 Composite `/workspace/` → FilesystemBackend（virtualMode） */
  rootDir: string
  /** 覆盖工具白名单；默认 STATE_FILESYSTEM_TOOL_NAMES（全套） */
  tools?: readonly FsToolName[] | 'all' | null
}

/**
 * 创建挂在 createAgent.middleware 上的文件系统中间件。
 * Composite：StateBackend（默认）+ `/workspace/` → FilesystemBackend；禁止 execute。
 */
export function createStateFilesystemMiddleware(options: CreateStateFilesystemMiddlewareOptions) {
  const {
    rootDir,
    tools = STATE_FILESYSTEM_TOOL_NAMES,
    permissions,
    customToolDescriptions,
    ...rest
  } = options
  const root = rootDir?.trim()
  if (!root) {
    throw new Error('createStateFilesystemMiddleware: rootDir is required')
  }

  return createFilesystemMiddleware({
    ...rest,
    backend: new CompositeBackend(new StateBackend(), {
      [WORKSPACE_ROUTE_PREFIX]: new FilesystemBackend({
        rootDir: resolve(root),
        virtualMode: true,
      }),
    }),
    tools,
    permissions: permissions ?? CHATVEIN_FS_DENY_PERMISSIONS,
    customToolDescriptions: customToolDescriptions ?? stateFilesystemCustomDescriptions(),
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

/** 是否为工作区路由虚路径（`/workspace` 或 `/workspace/...`） */
export function isWorkspaceVirtualPath(virtualPath: string): boolean {
  const n = virtualPath.replace(/\\/g, '/')
  return n === '/workspace' || n.startsWith(WORKSPACE_ROUTE_PREFIX)
}

/**
 * 相对工作区路径 → 虚路径。
 * - 相对路径 → `/workspace/rel`
 * - 已是 `/workspace/...` → 原样
 * - 其它以 `/` 开头 → State 草稿路径，原样保留
 */
export function toVirtualPath(relOrVirtual: string): string {
  const norm = relOrVirtual.replace(/\\/g, '/').replace(/^\.\//, '')
  if (norm === '/workspace' || norm.startsWith(WORKSPACE_ROUTE_PREFIX)) {
    return norm === '/workspace' ? WORKSPACE_ROUTE_PREFIX.slice(0, -1) : norm
  }
  if (norm.startsWith('/')) return norm
  return `${WORKSPACE_ROUTE_PREFIX}${norm.replace(/^\/+/, '')}`
}

/**
 * 虚路径 → 相对工作区路径。
 * `/workspace/src/a.ts` → `src/a.ts`；State 草稿 `/draft.md` → `draft.md`
 */
export function toRelativePath(virtualPath: string): string {
  const n = virtualPath.replace(/\\/g, '/')
  if (n.startsWith(WORKSPACE_ROUTE_PREFIX)) return n.slice(WORKSPACE_ROUTE_PREFIX.length)
  if (n === '/workspace') return ''
  return n.replace(/^\/+/, '')
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
 * 从磁盘灌入 **StateBackend 草稿键**（`/rel`，不含 `/workspace/` 前缀）。
 * Composite 下工作区读写已走 FilesystemBackend，办公/Forge 默认不再调用本函数。
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
        files[`/${rel}`] = textToFileData(text)
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
 * 把 StateBackend `files` 刷回磁盘（跳过 `/workspace/`——那些已由 FilesystemBackend 直写）。
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
    if (isWorkspaceVirtualPath(virtualPath)) continue
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
