/**
 * 思考流落盘：`{workspacePath}/logs/{messageId}.txt`
 * messageId = 对应助手回复 id，便于点击气泡回看。
 */
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

const SAFE_ID = /^[a-zA-Z0-9_-]+$/

export function thinkingLogPath(workspacePath: string, messageId: string): string {
  const id = sanitizeMessageId(messageId)
  return join(workspacePath, 'logs', `${id}.txt`)
}

export async function writeThinkingLog(
  workspacePath: string,
  messageId: string,
  text: string,
): Promise<void> {
  const root = workspacePath?.trim()
  if (!root) return
  const dir = join(root, 'logs')
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(thinkingLogPath(root, messageId), text ?? '', 'utf-8')
}

export async function readThinkingLog(
  workspacePath: string,
  messageId: string,
): Promise<string | null> {
  const root = workspacePath?.trim()
  if (!root) return null
  try {
    return await fs.readFile(thinkingLogPath(root, messageId), 'utf-8')
  } catch {
    return null
  }
}

function sanitizeMessageId(messageId: string): string {
  const id = messageId?.trim() ?? ''
  if (!SAFE_ID.test(id)) {
    throw new Error(`invalid thinking log message id: ${messageId}`)
  }
  return id
}
