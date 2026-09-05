/**
 * 短期记忆落盘：`{workspacePath}/memory/short-term.json`。
 *
 * 与聊天记录（SQLite）分开：摘要是**派生态**，会话删除时随工作区一起删除，
 * 不进 messages 表，也不参与历史重放。
 */
import type { ShortTermState } from '@chatvein/memory'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

const RELATIVE_PATH = join('memory', 'short-term.json')

export function shortTermStatePath(workspacePath: string): string {
  return join(workspacePath, RELATIVE_PATH)
}

export async function readShortTermState(
  workspacePath: string,
): Promise<ShortTermState | null> {
  const root = workspacePath?.trim()
  if (!root) return null
  try {
    const raw = await fs.readFile(shortTermStatePath(root), 'utf-8')
    return parseShortTermState(raw)
  } catch {
    return null
  }
}

export async function writeShortTermState(
  workspacePath: string,
  state: ShortTermState,
): Promise<void> {
  const root = workspacePath?.trim()
  if (!root || !state) return
  const file = shortTermStatePath(root)
  await fs.mkdir(join(root, 'memory'), { recursive: true })
  const tmp = `${file}.tmp`
  await fs.writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf-8')
  await fs.rename(tmp, file)
}

export async function resetShortTermState(workspacePath: string): Promise<void> {
  const root = workspacePath?.trim()
  if (!root) return
  await fs.rm(shortTermStatePath(root), { force: true }).catch(() => undefined)
}

/** 容错解析：结构不对就当没有（下次重新累积，不影响对话） */
export function parseShortTermState(raw: string): ShortTermState | null {
  try {
    const parsed = JSON.parse(raw) as Partial<ShortTermState>
    if (!parsed || typeof parsed !== 'object') return null
    if (parsed.version !== 1) return null
    if (typeof parsed.summary !== 'string') return null
    return {
      version: 1,
      summarizedThroughId:
        typeof parsed.summarizedThroughId === 'string' ? parsed.summarizedThroughId : null,
      summarizedCount: Number(parsed.summarizedCount) || 0,
      summary: parsed.summary,
      updatedAt: Number(parsed.updatedAt) || Date.now(),
    }
  } catch {
    return null
  }
}
