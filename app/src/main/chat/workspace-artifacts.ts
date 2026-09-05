/**
 * 会话工作区产物：磁盘 diff + ReAct 写文件类 tool_calls。
 * 供 ChatService 在一轮结束后推送到 ThinkingPanel「产物」。
 */
import type { BaseMessage } from '@langchain/core/messages'
import { AIMessage } from '@langchain/core/messages'
import { promises as fs } from 'node:fs'
import { basename, isAbsolute as isAbs, join, relative } from 'node:path'

export interface WorkspaceFileEntry {
  absPath: string
  /** 相对 workspace 根，统一用 `/` */
  relPath: string
  mtimeMs: number
  size: number
}

/** 与渲染层 ThinkingArtifact 对齐 */
export interface ChatArtifactItem {
  id: string
  title: string
  kind?: string
  detail?: string
  /** 绝对路径；点击「在文件夹中显示」用 */
  absPath?: string
}

const SKIP_DIRS = new Set(['node_modules', '.git', '.venv', '__pycache__', '.cache'])

const WRITE_TOOL_RE = /write|create|edit|save|append|mkdir|move|copy|upload|generate/i

/** 递归列出工作区文件（跳过常见噪音目录） */
export async function listWorkspaceFiles(root: string): Promise<WorkspaceFileEntry[]> {
  const out: WorkspaceFileEntry[] = []
  const base = root.trim()
  if (!base) return out

  async function walk(dir: string): Promise<void> {
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const ent of entries) {
      const abs = join(dir, ent.name)
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) continue
        await walk(abs)
        continue
      }
      if (!ent.isFile()) continue
      try {
        const st = await fs.stat(abs)
        out.push({
          absPath: abs,
          relPath: toPosixRel(base, abs),
          mtimeMs: st.mtimeMs,
          size: st.size,
        })
      } catch {
        /* 竞态删除忽略 */
      }
    }
  }

  await walk(base)
  return out
}

/** path → mtimeMs，用于本轮前后 diff */
export async function snapshotWorkspaceMtimes(root: string): Promise<Map<string, number>> {
  const files = await listWorkspaceFiles(root)
  return new Map(files.map((f) => [f.relPath, f.mtimeMs]))
}

/** 本轮新建或 mtime 变新的文件 → 产物条目 */
export function artifactsFromWorkspaceDiff(
  before: Map<string, number>,
  after: WorkspaceFileEntry[],
): ChatArtifactItem[] {
  const items: ChatArtifactItem[] = []
  for (const f of after) {
    const prev = before.get(f.relPath)
    if (prev !== undefined && f.mtimeMs <= prev) continue
    items.push(fileToArtifact(f))
  }
  return items
}

/** 从 AIMessage.tool_calls 抽取写文件类路径 */
export function artifactsFromReactMessages(
  messages: BaseMessage[],
  workspaceRoot: string,
): ChatArtifactItem[] {
  const byId = new Map<string, ChatArtifactItem>()
  for (const m of messages) {
    if (!AIMessage.isInstance(m)) continue
    for (const call of m.tool_calls ?? []) {
      const name = String(call.name ?? '')
      if (!WRITE_TOOL_RE.test(name)) continue
      const pathArg = pathFromToolArgs(call.args)
      if (!pathArg) continue
      const rel = normalizeToolPath(pathArg, workspaceRoot)
      const id = rel
      if (byId.has(id)) continue
      byId.set(id, {
        id,
        title: basename(rel.replace(/\\/g, '/')) || rel,
        kind: kindFromRel(rel),
        detail: rel,
        absPath: isAbs(pathArg) ? pathArg : join(workspaceRoot, rel),
      })
    }
  }
  return [...byId.values()]
}

export function mergeArtifacts(...lists: ChatArtifactItem[][]): ChatArtifactItem[] {
  const byId = new Map<string, ChatArtifactItem>()
  for (const list of lists) {
    for (const a of list) {
      if (!byId.has(a.id)) byId.set(a.id, a)
    }
  }
  return [...byId.values()].sort((a, b) => a.title.localeCompare(b.title, 'zh'))
}

function fileToArtifact(f: WorkspaceFileEntry): ChatArtifactItem {
  return {
    id: f.relPath,
    title: basename(f.relPath) || f.relPath,
    kind: kindFromRel(f.relPath),
    detail: f.relPath,
    absPath: f.absPath,
  }
}

function kindFromRel(rel: string): string {
  const r = rel.replace(/\\/g, '/')
  if (r.startsWith('scripts/')) return 'script'
  if (r.startsWith('runs/')) return 'run'
  const ext = r.includes('.') ? r.slice(r.lastIndexOf('.') + 1).toLowerCase() : ''
  if (['py', 'js', 'ts', 'mjs', 'cjs', 'sh', 'ps1'].includes(ext)) return 'script'
  if (['md', 'txt', 'json', 'csv', 'html', 'css'].includes(ext)) return 'file'
  return 'file'
}

function toPosixRel(root: string, abs: string): string {
  return relative(root, abs).split(/[/\\]/).join('/')
}

function pathFromToolArgs(args: unknown): string | undefined {
  if (!args || typeof args !== 'object') return undefined
  const o = args as Record<string, unknown>
  for (const k of ['path', 'file_path', 'filepath', 'filename', 'file', 'target', 'dest', 'destination']) {
    const v = o[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return undefined
}

/** 工具参数可能是绝对路径或相对 workspace */
function normalizeToolPath(pathArg: string, workspaceRoot: string): string {
  const root = workspaceRoot.trim()
  const normalized = pathArg.replace(/\\/g, '/')
  const rootPosix = root.replace(/\\/g, '/')
  if (root && (normalized === rootPosix || normalized.startsWith(`${rootPosix}/`))) {
    return toPosixRel(root, pathArg)
  }
  return normalized.replace(/^\.\//, '')
}
