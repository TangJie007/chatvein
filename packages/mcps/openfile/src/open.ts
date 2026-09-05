import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, normalize, resolve, sep } from 'node:path'
import { promises as fs } from 'node:fs'

export type OpenTargetKind = 'dir' | 'file'

export interface ResolveFolderResult {
  /** 最终要在文件管理器中打开的目录（绝对路径） */
  folder: string
  /** 输入路径解析后是文件还是目录 */
  kind: OpenTargetKind
  /** 规范化后的输入绝对路径 */
  input: string
}

/** 展开 `~` */
export function expandHome(filepath: string): string {
  const trimmed = filepath.trim()
  if (trimmed === '~') return homedir()
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return resolve(homedir(), trimmed.slice(2))
  }
  return trimmed
}

/** 判断 `target` 是否位于 `root` 之内（含 root 自身） */
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

/**
 * 若配置了 allowedRoots，要求路径（及其父目录）落在某一根下。
 * `allowedRoots` 为空数组时不限制。
 */
export function assertAllowed(pathAbs: string, allowedRoots: string[]): void {
  if (allowedRoots.length === 0) return
  const ok = allowedRoots.some((root) => isPathWithin(root, pathAbs))
  if (!ok) {
    throw new Error(
      `路径越出允许目录：${pathAbs}（允许：${allowedRoots.map((r) => resolve(r)).join(', ')}）`,
    )
  }
}

/**
 * 解析「应打开的文件夹」：目录原样；文件取其父目录。
 * 路径必须已存在。
 */
export async function resolveFolderToOpen(
  inputPath: string,
  allowedRoots: string[] = [],
): Promise<ResolveFolderResult> {
  if (!inputPath?.trim()) {
    throw new Error('path 不能为空')
  }
  const absolute = resolve(expandHome(inputPath))
  assertAllowed(absolute, allowedRoots)

  let st
  try {
    st = await fs.stat(absolute)
  } catch {
    throw new Error(`路径不存在：${absolute}`)
  }

  if (st.isDirectory()) {
    return { folder: normalize(absolute), kind: 'dir', input: absolute }
  }
  if (st.isFile()) {
    const folder = dirname(absolute)
    assertAllowed(folder, allowedRoots)
    return { folder: normalize(folder), kind: 'file', input: absolute }
  }
  throw new Error(`不是文件或目录：${absolute}`)
}

/**
 * 在系统文件管理器中打开目录。
 * Windows 上 `explorer.exe` 常以非 0 退出，故不等待进程结束。
 */
export function openFolderInOs(folder: string): Promise<void> {
  const target = normalize(resolve(folder))
  return new Promise((resolvePromise, reject) => {
    const child =
      process.platform === 'win32'
        ? spawn('explorer.exe', [target], { detached: true, stdio: 'ignore' })
        : process.platform === 'darwin'
          ? spawn('open', [target], { detached: true, stdio: 'ignore' })
          : spawn('xdg-open', [target], { detached: true, stdio: 'ignore' })

    child.on('error', reject)
    child.unref()
    // 成功 spawn 即视为已发起打开；Windows explorer 退出码不可靠
    if (child.pid != null) {
      resolvePromise()
      return
    }
    child.once('spawn', () => resolvePromise())
  })
}

/** 解析并打开；返回给人读的结果文案 */
export async function openFolderPath(
  inputPath: string,
  allowedRoots: string[] = [],
): Promise<{ message: string; folder: string; kind: OpenTargetKind }> {
  const resolved = await resolveFolderToOpen(inputPath, allowedRoots)
  await openFolderInOs(resolved.folder)
  const message =
    resolved.kind === 'dir'
      ? `已打开文件夹：${resolved.folder}`
      : `路径是文件，已打开所在文件夹：${resolved.folder}（文件：${resolved.input}）`
  return { message, folder: resolved.folder, kind: resolved.kind }
}
