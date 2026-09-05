import { randomUUID } from 'node:crypto'

/** 会话目录 slug：YYYYMMDD-HHmmss-<8hex> */
export function makeConversationSlug(now = Date.now()): string {
  const d = new Date(now)
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  return `${stamp}-${randomUUID().replace(/-/g, '').slice(0, 8)}`
}
