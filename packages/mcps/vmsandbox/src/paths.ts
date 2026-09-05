/**
 * 工作区路径 jail（对齐 openfile）。
 */
import { resolve, normalize, sep } from 'node:path'
import { homedir } from 'node:os'

export function expandHome(filepath: string): string {
  const trimmed = filepath.trim()
  if (trimmed === '~') return homedir()
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return resolve(homedir(), trimmed.slice(2))
  }
  return trimmed
}

export function isPathWithin(root: string, target: string): boolean {
  const r = resolve(root)
  const t = resolve(target)
  if (process.platform === 'win32') {
    const rl = r.toLowerCase()
    const tl = t.toLowerCase()
    return tl === rl || tl.startsWith(rl.endsWith(sep) ? rl : rl + sep)
  }
  return t === r || t.startsWith(r.endsWith(sep) ? r : r + sep)
}

export function assertWithinWorkspace(workspaceRoot: string, pathAbs: string): void {
  const root = resolve(workspaceRoot)
  if (!isPathWithin(root, pathAbs)) {
    throw new Error(`路径越出工作区：${pathAbs}（根：${root}）`)
  }
}

/** 相对工作区解析为绝对路径并 jail */
export function resolveInWorkspace(workspaceRoot: string, relativeOrAbs: string): string {
  const root = resolve(workspaceRoot)
  const raw = expandHome(relativeOrAbs.trim())
  const abs = normalize(resolve(root, raw))
  assertWithinWorkspace(root, abs)
  return abs
}
