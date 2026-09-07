import { resolve, relative, sep, isAbsolute } from 'node:path'

/**
 * 路径 jail：所有工具读写、exec cwd 都不得越出 workspace 根。
 * 规范化后用相对路径前缀判断，兼容 Windows 盘符与大小写。
 */
export class PathJail {
  readonly root: string

  constructor(root: string) {
    this.root = resolve(root)
  }

  /** 把（可能相对 workspace 的）路径解析为绝对路径；越界抛错 */
  resolve(relOrAbs: string): string {
    const target = isAbsolute(relOrAbs) ? resolve(relOrAbs) : resolve(this.root, relOrAbs)
    if (!this.isInside(target)) {
      throw new Error(`路径越出工作区，已拒绝：${relOrAbs}（workspace=${this.root}）`)
    }
    return target
  }

  /** 判断绝对路径是否在 workspace 内（含根本身） */
  isInside(absPath: string): boolean {
    const rel = relative(this.root, absPath)
    if (rel === '') return true
    // rel 以 '..' 开头或是绝对路径（Windows 跨盘）即越界
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return false
    return true
  }
}
