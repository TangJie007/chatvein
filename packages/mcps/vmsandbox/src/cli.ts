import { startVmsandboxServer } from './server'

/**
 * argv: [workspaceRoot] [--timeout=ms] [--max-output=n] [--allow-any-js]
 * Chat 默认传入 workspaceRoot；未传则拒绝启动（避免无 jail 的裸沙箱）。
 */
function parseArgs(argv: string[]): {
  workspaceRoot?: string
  timeoutMs?: number
  maxOutputChars?: number
  scriptsOnly: boolean
} {
  let workspaceRoot: string | undefined
  let timeoutMs: number | undefined
  let maxOutputChars: number | undefined
  let scriptsOnly = true
  for (const a of argv) {
    if (!a) continue
    if (a === '--allow-any-js') scriptsOnly = false
    else if (a.startsWith('--timeout=')) {
      const n = Number(a.slice('--timeout='.length))
      if (Number.isFinite(n) && n > 0) timeoutMs = n
    } else if (a.startsWith('--max-output=')) {
      const n = Number(a.slice('--max-output='.length))
      if (Number.isFinite(n) && n > 0) maxOutputChars = n
    } else if (!a.startsWith('-') && !workspaceRoot) {
      workspaceRoot = a
    }
  }
  return { workspaceRoot, timeoutMs, maxOutputChars, scriptsOnly }
}

const opts = parseArgs(process.argv.slice(2))
if (!opts.workspaceRoot?.trim()) {
  console.error(
    '[mcp-vmsandbox] 需要 workspaceRoot 参数，例如：node dist/cli.js D:/ws',
  )
  process.exit(1)
}

startVmsandboxServer({
  workspaceRoot: opts.workspaceRoot,
  timeoutMs: opts.timeoutMs,
  maxOutputChars: opts.maxOutputChars,
  scriptsOnly: opts.scriptsOnly,
}).catch((err) => {
  console.error('[mcp-vmsandbox] failed to start:', err)
  process.exit(1)
})
