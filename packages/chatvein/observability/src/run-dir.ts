import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

export interface RunDirLayout {
  root: string
  tracePath: string
  payloadsDir: string
}

/** 初始化 runs/<runId>/ 目录布局 */
export async function initRunDir(runsRoot: string, runId: string): Promise<RunDirLayout> {
  const root = join(runsRoot, runId)
  const payloadsDir = join(root, 'payloads')
  await mkdir(payloadsDir, { recursive: true })
  return {
    root,
    tracePath: join(root, 'trace.jsonl'),
    payloadsDir,
  }
}
