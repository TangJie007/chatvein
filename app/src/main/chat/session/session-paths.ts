import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

/** 会话目录 slug：YYYYMMDD-HHmmss-<8hex> */
export function makeConversationSlug(now = Date.now()): string {
  const d = new Date(now)
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  return `${stamp}-${randomUUID().replace(/-/g, '').slice(0, 8)}`
}

/**
 * 对话产物目录名：所有对话产出的文件都落在会话工作区下的 `output/`，
 * 产物面板也只扫描 / 展示该目录内的文件。
 */
export const OUTPUT_DIRNAME = 'output'

/** 会话产物目录绝对路径：{workspacePath}/output */
export function conversationOutputPath(workspacePath: string): string {
  return join(workspacePath, OUTPUT_DIRNAME)
}
