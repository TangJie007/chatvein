#!/usr/bin/env node
/**
 * forge — Chatvein headless CLI.
 *
 * Commands (implemented incrementally per docs/phase1/03-开发计划书.md):
 *   forge run <requirement.md> [--config forge.config.ts]
 *   forge preview <requirement.md>
 *   forge resume <run-id>
 *   forge regression
 *
 * This is the bin entry wired to `dist/cli.js`. It deliberately contains only
 * argument parsing / exit codes — all logic lives in @chatvein/core.
 */
import cac from 'cac'
import { CHATVEIN_SERVICE_VERSION } from './index'

const program = cac('forge')

program
  .command('run <requirement>', 'Start a forge run for a requirement document')
  .option('--config <path>', 'Path to forge.config')
  .action(() => {
    // TODO M1-9: bootstrap Harness and start a run.
    console.error('[forge] run not implemented yet (M1-9)')
    process.exitCode = 1
  })

program
  .command('preview <requirement>', 'Preview the compiled task tree without starting a run')
  .action(() => {
    console.error('[forge] preview not implemented yet (M2-1)')
    process.exitCode = 1
  })

program
  .command('resume <runId>', 'Resume a run from its latest checkpoint')
  .action(() => {
    console.error('[forge] resume not implemented yet (M2-7)')
    process.exitCode = 1
  })

program
  .command('regression', 'Run fixed requirement + seed and compare metrics')
  .action(() => {
    console.error('[forge] regression not implemented yet (M2-7)')
    process.exitCode = 1
  })

program.option('--version', 'Show version')
program.help()
program.version(CHATVEIN_SERVICE_VERSION)

program.parse()
