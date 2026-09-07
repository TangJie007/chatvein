#!/usr/bin/env node
/**
 * forge — Chatvein headless CLI.
 *
 * Commands:
 *   forge run <requirement.md> [--config forge.config.ts] [--single] [--skip-build]
 *                              [--build-cmd ...] [--test-cmd ...] [--runs-root ...]
 *   forge preview <requirement.md> [--single]
 *   forge resume <run-id> [--config ...]
 *   forge regression           (M2-7)
 *
 * 只做参数解析 / 退出码；所有逻辑来自 @chatvein/core。
 */
import cac from 'cac'
import { resolve } from 'node:path'
import { createHarness } from '@chatvein/core'
import type { TraceEvent } from '@chatvein/common'
import { loadForgeConfig } from './config-loader'
import { CHATVEIN_SERVICE_VERSION } from './index'

function parseArgvList(value?: string): string[] | undefined {
  if (!value) return undefined
  return value.split(' ').map((s) => s.trim()).filter(Boolean)
}

function printEvent(e: TraceEvent): void {
  const ts = new Date(e.ts).toISOString().slice(11, 23)
  switch (e.kind) {
    case 'node_enter':
      console.log(`${ts} ▶ ${e.name ?? ''} ${JSON.stringify(e.payload ?? {})}`)
      break
    case 'node_exit':
      console.log(`${ts} ✔ ${e.name ?? ''}`)
      break
    case 'tool_call':
      console.log(`${ts}   🔧 ${e.name} (${e.durationMs ?? 0}ms)${e.error ? ` ERROR: ${e.error}` : ''}`)
      break
    case 'verify': {
      const p = (e.payload ?? {}) as { passed?: boolean; testFailed?: number; buildStatus?: string }
      console.log(`${ts} 🧪 verify: build=${p.buildStatus} failed=${p.testFailed ?? 0} passed=${p.passed}`)
      break
    }
    case 'model_call':
      console.log(`${ts}   🤖 model ${e.name}`)
      break
    case 'error':
      console.error(`${ts} ✗ ${e.name ?? ''}: ${e.error ?? JSON.stringify(e.payload ?? {})}`)
      break
    case 'run_start':
      console.log(`${ts} ── run_start ${(e.payload as { runId?: string })?.runId ?? ''}`)
      break
    case 'run_end': {
      const p = (e.payload ?? {}) as { status?: string; totalTokens?: number }
      console.log(`${ts} ── run_end status=${p.status} tokens=${p.totalTokens ?? 0}`)
      break
    }
    default:
      break
  }
}

const program = cac('forge')

program
  .command('run <requirement>', 'Start a forge run for a requirement document')
  .option('--config <path>', 'Path to forge.config (.ts/.mjs/.js/.json)')
  .option('--single', 'Compile whole requirement into a single task')
  .option('--skip-build', 'Skip the build step (script-only tasks)')
  .option('--build-cmd <cmd>', 'Override build command, e.g. "npm run build"')
  .option('--test-cmd <cmd>', 'Override test command, e.g. "npx vitest run"')
  .option('--runs-root <path>', 'Runs output root directory')
  .action(async (requirement: string, opts: Record<string, unknown>) => {
    try {
      const config = await loadForgeConfig(opts.config as string | undefined)
      const harness = createHarness({
        config,
        runsRoot: (opts.runsRoot as string) ?? config.runsRoot,
      })
      const handle = await harness.start({
        requirementPath: resolve(process.cwd(), requirement),
        compileStrategy: opts.single ? 'single' : 'sections',
        skipBuild: !!opts.skipBuild,
        buildCommand: parseArgvList(opts.buildCmd as string | undefined),
        testCommand: parseArgvList(opts.testCmd as string | undefined),
      })
      handle.onEvent(printEvent)
      const report = await handle.done
      console.log('\n===== 运行报告 =====')
      console.log(`runId:    ${report.runId}`)
      console.log(`状态:     ${report.status}`)
      console.log(`产物目录: ${report.runDir}`)
      if (report.failedTasks.length) console.log(`失败任务: ${report.failedTasks.join(', ')}`)
      console.log(`\n${report.summary}`)
      process.exitCode = report.status === 'done' ? 0 : 1
    } catch (err) {
      console.error('[forge] run 失败：', (err as Error).message)
      process.exitCode = 1
    }
  })

program
  .command('preview <requirement>', 'Preview the compiled task tree without starting a run')
  .option('--single', 'Compile whole requirement into a single task')
  .action(async (requirement: string, opts: Record<string, unknown>) => {
    try {
      const harness = createHarness({ config: { models: { strong: [], medium: [], weak: [] } } })
      const plan = await harness.preview({
        requirementPath: resolve(process.cwd(), requirement),
        strategy: opts.single ? 'single' : 'sections',
      })
      console.log(`任务树（${plan.taskCount} 个任务）：`)
      for (const t of plan.taskTree) {
        console.log(`  [${t.status}] ${t.id} ${t.title}  (${t.estimatedComplexity}, 依赖: ${t.dependsOn.join(',') || '无'})`)
        for (const a of t.acceptance) console.log(`      - ${a}`)
      }
    } catch (err) {
      console.error('[forge] preview 失败：', (err as Error).message)
      process.exitCode = 1
    }
  })

program
  .command('resume <runId>', 'Resume a run from its latest checkpoint')
  .option('--config <path>', 'Path to forge.config')
  .option('--runs-root <path>', 'Runs output root directory')
  .action(async (runId: string, opts: Record<string, unknown>) => {
    try {
      const config = await loadForgeConfig(opts.config as string | undefined)
      const harness = createHarness({
        config,
        runsRoot: (opts.runsRoot as string) ?? config.runsRoot,
      })
      const handle = await harness.resume(runId)
      handle.onEvent(printEvent)
      const report = await handle.done
      console.log(`\n===== 续跑结束：${report.status} =====`)
      process.exitCode = report.status === 'done' ? 0 : 1
    } catch (err) {
      console.error('[forge] resume 失败：', (err as Error).message)
      process.exitCode = 1
    }
  })

program
  .command('regression', 'Run fixed requirement + seed and compare metrics')
  .action(() => {
    console.error('[forge] regression 将在 M2-7 实现')
    process.exitCode = 1
  })

program.option('--version', 'Show version')
program.help()
program.version(CHATVEIN_SERVICE_VERSION)

program.parse()
// action 回调是 async 的；捕获未处理 rejection 以正确设置退出码
process.on('unhandledRejection', (err) => {
  console.error('[forge] 未处理错误：', (err as Error)?.message ?? err)
  process.exitCode = 1
})
