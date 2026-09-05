import { startModsearchServer } from './server'

/** 可选：--timeout=ms --no-fallback */
function parseArgs(argv: string[]): { timeoutMs?: number; fallback: boolean } {
  let timeoutMs: number | undefined
  let fallback = true
  for (const a of argv) {
    if (a === '--no-fallback') fallback = false
    else if (a.startsWith('--timeout=')) {
      const n = Number(a.slice('--timeout='.length))
      if (Number.isFinite(n) && n > 0) timeoutMs = n
    }
  }
  return { timeoutMs, fallback }
}

const opts = parseArgs(process.argv.slice(2))

startModsearchServer(opts).catch((err) => {
  console.error('[mcp-modsearch] failed to start:', err)
  process.exit(1)
})
