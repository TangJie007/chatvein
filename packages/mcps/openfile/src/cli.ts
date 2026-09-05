import { startOpenfileServer } from './server'

const allowed = process.argv.slice(2).filter((a) => a && !a.startsWith('-'))

startOpenfileServer(allowed).catch((err) => {
  console.error('[mcp-openfile] failed to start:', err)
  process.exit(1)
})
