import { startShellsandboxServer } from './server'

/** argv: [workspaceRoot] [--timeout=ms] */
function parseArgs(argv: string[]): { workspaceRoot?: string; defaultTimeoutMs?: number } {
  let workspaceRoot: string | undefined
  let defaultTimeoutMs: number | undefined
  for (const a of argv) {
    if (!a) continue
    if (a.startsWith('--timeout=')) {
      const n = Number(a.slice('--timeout='.length))
      if (Number.isFinite(n) && n > 0) defaultTimeoutMs = n
    } else if (!a.startsWith('-') && !workspaceRoot) {
      workspaceRoot = a
    }
  }
  return { workspaceRoot, defaultTimeoutMs }
}

const opts = parseArgs(process.argv.slice(2))
if (!opts.workspaceRoot?.trim()) {
  console.error('[mcp-shellsandbox] 需要 workspaceRoot，例如：node dist/cli.js D:/project')
  process.exit(1)
}

startShellsandboxServer({
  workspaceRoot: opts.workspaceRoot,
  defaultTimeoutMs: opts.defaultTimeoutMs,
}).catch((err) => {
  console.error('[mcp-shellsandbox] failed to start:', err)
  process.exit(1)
})
