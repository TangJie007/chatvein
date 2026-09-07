/**
 * Harness 门面：app（Electron）与 service（CLI/sidecar）唯一直接 import 的入口。
 *
 * 职责：加载配置 → 准备沙箱工作区 → 初始化 trace → 驱动 orchestrator → 透传事件 → 收尾。
 * 能力全部来自 @chatvein/* 纯 Node 包；本类不 import electron / langchain。
 * Cordis 根 Context 由 index.ts 持有（插件生命周期），M1 先用直接装配跑通闭环。
 */
import { randomUUID } from 'node:crypto'
import { resolve, join } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import {
  type ForgeConfig,
  type TaskTree,
  type TraceEvent,
  parseForgeConfig,
} from '@chatvein/common'
import { LocalSandboxProvider } from '@chatvein/sandbox'
import { TraceSink, EventBus } from '@chatvein/observability'
import { compileRequirement, compileToFile } from '@chatvein/compiler'
import { runForge, type RunForgeResult } from '@chatvein/orchestrator'

export interface StartRunInput {
  /** 需求文档绝对/相对路径 */
  requirementPath: string
  /** 覆盖配置；缺省用 createHarness 时的 config */
  config?: ForgeConfig
  /** 运行 id；缺省自动生成 */
  runId?: string
  /** 验证命令覆盖 */
  buildCommand?: string[]
  testCommand?: string[]
  skipBuild?: boolean
  compileStrategy?: 'single' | 'sections'
  /** 工作区模板路径（仅当未指定 workspacePath 时，拷贝进 runs/<id>/workspace） */
  templatePath?: string
  /**
   * 沙箱工作区绝对路径覆盖。
   * Chat「编程开发」档传入用户项目根，使 Forge 工具直接作用于真实仓库；
   * 缺省仍为 `runs/<runId>/workspace`。
   */
  workspacePath?: string
  /** 用户取消 */
  signal?: AbortSignal
  /** 断点续跑（复用同一 runId 的 checkpointer） */
  resume?: boolean
}

export interface RunPlan {
  taskTree: TaskTree
  taskCount: number
}

export interface RunReport {
  runId: string
  status: 'done' | 'aborted'
  summary: string
  failedTasks: string[]
  runDir: string
}

export interface RunHandle {
  runId: string
  /** 订阅运行事件（trace 事件超集） */
  onEvent(listener: (e: TraceEvent) => void): () => void
  /** 运行结束 Promise */
  done: Promise<RunReport>
}

export interface HarnessOptions {
  config: ForgeConfig
  /** runs 根目录；缺省用 config.runsRoot（相对 cwd 解析） */
  runsRoot?: string
}

interface RunMeta {
  runId: string
  requirementPath: string
  workspacePath?: string
  buildCommand?: string[]
  testCommand?: string[]
  skipBuild?: boolean
  compileStrategy?: 'single' | 'sections'
  startedAt: string
  config?: unknown
  env?: unknown
}

export class Harness {
  private readonly config: ForgeConfig
  private readonly runsRoot: string
  /** 运行事件总线（跨 run 复用，订阅者按 runId 过滤） */
  readonly bus = new EventBus()

  constructor(options: HarnessOptions) {
    this.config = options.config
    this.runsRoot = resolve(options.runsRoot ?? options.config.runsRoot ?? 'runs')
  }

  /** 预览任务树：只跑 compiler 的确定性编译，不启动编排、不耗模型 */
  async preview(input: {
    requirementPath: string
    strategy?: 'single' | 'sections'
  }): Promise<RunPlan> {
    const markdown = await readFile(resolve(input.requirementPath), 'utf8')
    const taskTree = compileRequirement({
      markdown,
      requirementPath: input.requirementPath,
      strategy: input.strategy ?? 'sections',
    })
    return { taskTree, taskCount: taskTree.length }
  }

  /** 启动一次运行 */
  async start(input: StartRunInput): Promise<RunHandle> {
    const config = input.config ?? this.config
    const runId = input.runId ?? `run-${Date.now()}-${randomUUID().slice(0, 8)}`
    const runDir = join(this.runsRoot, runId)
    const workspacePath = input.workspacePath
      ? resolve(input.workspacePath)
      : join(runDir, 'workspace')
    const requirementPath = resolve(input.requirementPath)

    const sandbox = new LocalSandboxProvider({
      workspacePath,
      // 已指定外部工作区时不再拷贝模板，避免污染用户项目
      templatePath: input.workspacePath ? undefined : input.templatePath,
      allowCommands: config.tools.execAllowlist,
    })
    await sandbox.prepare()

    const onAbort = () => {
      sandbox.killRunning()
    }
    input.signal?.addEventListener('abort', onAbort, { once: true })

    const trace = await TraceSink.create({ runsRoot: this.runsRoot, runId, bus: this.bus })

    // 环境快照落 run.json（含 workspace / 验证命令，供 resume）
    const snapshot = await sandbox.snapshot()
    const meta: RunMeta = {
      runId,
      requirementPath,
      workspacePath,
      buildCommand: input.buildCommand,
      testCommand: input.testCommand,
      skipBuild: input.skipBuild,
      compileStrategy: input.compileStrategy ?? 'sections',
      startedAt: new Date().toISOString(),
      config: redactConfig(config),
      env: snapshot,
    }
    await writeFile(join(runDir, 'run.json'), JSON.stringify(meta, null, 2), 'utf8')

    // 任务树落盘（plan 节点也会编译，这里先落一份供预览/复盘）
    if (!input.resume) {
      const requirementText = await readFile(requirementPath, 'utf8')
      await compileToFile({
        markdown: requirementText,
        requirementPath,
        strategy: input.compileStrategy ?? 'sections',
        outPath: join(runDir, 'tasks.json'),
      })
    }

    let resolveDone!: (r: RunReport) => void
    let rejectDone!: (e: unknown) => void
    const done = new Promise<RunReport>((res, rej) => {
      resolveDone = res
      rejectDone = rej
    })

    const handle: RunHandle = {
      runId,
      onEvent: (listener) => this.bus.on(listener),
      done,
    }

    // 异步驱动，事件经 trace.bus 实时回流
    void (async () => {
      try {
        const requirementText = await readFile(requirementPath, 'utf8')
        const result: RunForgeResult = await runForge({
          runId,
          runsRoot: this.runsRoot,
          requirementPath,
          requirementText,
          config,
          sandbox,
          trace,
          buildCommand: input.buildCommand,
          testCommand: input.testCommand,
          skipBuild: input.skipBuild,
          compileStrategy: input.compileStrategy,
          signal: input.signal,
          resume: input.resume,
        })
        const report: RunReport = {
          runId,
          status: result.status,
          summary: result.finalSummary,
          failedTasks: result.failedTasks,
          runDir,
        }
        await writeFile(join(runDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8')
        resolveDone(report)
      } catch (err) {
        await trace
          .emit('error', { name: 'run_failed', error: (err as Error).message })
          .catch(() => {})
        rejectDone(err)
      } finally {
        input.signal?.removeEventListener('abort', onAbort)
      }
    })()

    return handle
  }

  /** 从 checkpoint 恢复（复用 run.json 中的 workspace / 验证命令） */
  async resume(runId: string, signal?: AbortSignal): Promise<RunHandle> {
    const runDir = join(this.runsRoot, runId)
    const runMeta = JSON.parse(await readFile(join(runDir, 'run.json'), 'utf8')) as RunMeta
    return this.start({
      requirementPath: runMeta.requirementPath,
      runId,
      workspacePath: runMeta.workspacePath,
      buildCommand: runMeta.buildCommand,
      testCommand: runMeta.testCommand,
      skipBuild: runMeta.skipBuild,
      compileStrategy: runMeta.compileStrategy,
      signal,
      resume: true,
    })
  }

  /** 读取历史运行产物 */
  async loadRun(runId: string): Promise<{
    runDir: string
    tasks?: TaskTree
    report?: RunReport
  }> {
    const runDir = join(this.runsRoot, runId)
    const out: { runDir: string; tasks?: TaskTree; report?: RunReport } = { runDir }
    try {
      out.tasks = JSON.parse(await readFile(join(runDir, 'tasks.json'), 'utf8')) as TaskTree
    } catch {
      // tasks 可能尚未生成
    }
    try {
      out.report = JSON.parse(await readFile(join(runDir, 'report.json'), 'utf8')) as RunReport
    } catch {
      // 报告在结束时才写
    }
    return out
  }
}

/** 构造 Harness；rawConfig 可为已校验 config 或待解析的原始对象（统一过 zod） */
export function createHarness(options: {
  config: ForgeConfig | unknown
  runsRoot?: string
}): Harness {
  const config = parseForgeConfig(options.config)
  return new Harness({
    config,
    runsRoot: options.runsRoot,
  })
}

/** 脱敏：不把 apiKey 写进 run.json */
function redactConfig(config: ForgeConfig): unknown {
  return {
    ...config,
    models: Object.fromEntries(
      Object.entries(config.models).map(([tier, endpoints]) => [
        tier,
        endpoints.map((e) => ({ ...e, apiKey: e.apiKey ? '***' : undefined })),
      ]),
    ),
  }
}
