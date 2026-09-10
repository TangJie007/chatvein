#!/usr/bin/env node
import * as path from 'node:path'
import { generateIpcTypes } from './generate'

function printUsage(): void {
  console.log(`Usage: electrum-codegen [options]

Options:
  --tsconfig <path>   Path to tsconfig.json (required)
  --output <path>     Output IpcApi declaration file (required)
  --preload <path>    Also write a preload script (exposeApi + channel allowlist)
  --include <glob>    Source glob (repeatable, default: all project .ts files)
  --no-dev-only       Skip @IpcHandle({ devOnly: true }) channels
  --global            Also emit Window.api global declaration
  -h, --help          Show help
`)
}

function parseArgs(argv: string[]): {
  tsconfig?: string
  output?: string
  preload?: string
  include: string[]
  includeDevOnly?: boolean
  includeGlobal?: boolean
  help?: boolean
} {
  const result: ReturnType<typeof parseArgs> = { include: [] }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    switch (arg) {
      case '--tsconfig':
        result.tsconfig = argv[++i]
        break
      case '--output':
        result.output = argv[++i]
        break
      case '--preload':
        result.preload = argv[++i]
        break
      case '--include':
        result.include.push(argv[++i])
        break
      case '--no-dev-only':
        result.includeDevOnly = false
        break
      case '--global':
        result.includeGlobal = true
        break
      case '-h':
      case '--help':
        result.help = true
        break
      default:
        console.error(`Unknown argument: ${arg}`)
        result.help = true
    }
  }

  return result
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  if (args.help || !args.tsconfig || !args.output) {
    printUsage()
    process.exit(args.help && args.tsconfig && args.output ? 0 : 1)
  }

  const { channels, outputPath, preloadOutputPath } = await generateIpcTypes({
    tsconfig: path.resolve(args.tsconfig),
    outputPath: path.resolve(args.output),
    preloadOutputPath: args.preload ? path.resolve(args.preload) : undefined,
    include: args.include.length > 0 ? args.include : undefined,
    includeDevOnly: args.includeDevOnly,
    includeGlobal: args.includeGlobal,
  })

  console.log(`Generated ${channels.length} IPC channel(s) → ${outputPath}`)
  if (preloadOutputPath) {
    console.log(`Generated preload script → ${preloadOutputPath}`)
  }
}

main().catch((err) => {
  console.error('[electrum-codegen] failed:', err)
  process.exit(1)
})
