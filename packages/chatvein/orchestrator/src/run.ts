/**
 * 一次 Forge 运行的高层入口：装配图、checkpointer、初始状态并驱动到结束。
 * core/service 调这里；本模块不碰 Cordis / Electron。
 */
import { join } from 'node:path'
import { WorkspaceCheckpointer } from '@chatvein/agents'
import type { ModelEndpointConfig, ModelTier, ForgeConfig } from '@chatvein/common'
import { createLangChainChatModel } from '@chatvein/models'
import { ModelRouter } from '@chatvein/models'
import { createEndpointModel } from '@chatvein/models'
import type { SandboxProvider } from '@chatvein/sandbox'
import type { TraceSink } from '@chatvein/observability'
import { buildOrchestratorGraph, type OrchestratorDeps } from './graph'

export interface RunForgeInput {
  runId: string
  runsRoot: string
  requirementPath: string
  requirementText?: string
  config: ForgeConfig
  sandbox: SandboxProvider
  trace: TraceSink
  /** 断点续跑：传入 threadId 复用 checkpoint */
  resume?: boolean
  buildCommand?: string[]
  testCommand?: string[]
  skipBuild?: boolean
  compileStrategy?: 'single' | 'sections'
}

export interface RunForgeResult {
  status: 'done' | 'aborted'
  finalSummary: string
  failedTasks: string[]
}

/** 由配置构造 LangChain 模型选择器（强/中/弱） */
function buildLcModel(config: ForgeConfig): OrchestratorDeps['lcModel'] {
  const cache = new Map<ModelTier, ReturnType<typeof createLangChainChatModel>>()
  return (tier) => {
    const hit = cache.get(tier)
    if (hit) return hit
    const endpoint = config.models[tier]?.[0]
    if (!endpoint) throw new Error(`未配置模型档：${tier}`)
    const m = createLangChainChatModel(endpoint as ModelEndpointConfig & { baseUrl: string })
    cache.set(tier, m)
    return m
  }
}

/** 由配置构造纯文本模型选择器（diagnose/summarize 走 fetch 直连，省 LangChain 开销） */
function buildTextModel(config: ForgeConfig): OrchestratorDeps['textModel'] {
  const router = new ModelRouter({
    tiers: {
      strong: (config.models.strong ?? []).map(createEndpointModel),
      medium: (config.models.medium ?? []).map(createEndpointModel),
      weak: (config.models.weak ?? []).map(createEndpointModel),
    },
    maxAttempts: config.retry.maxAttempts,
  })
  return (tier) => async (messages) => {
    const res = await router.invoke(tier, messages)
    return {
      content: res.content,
      model: res.model,
      usage: {
        promptTokens: res.usage.promptTokens,
        completionTokens: res.usage.completionTokens,
        totalTokens: res.usage.totalTokens,
      },
    }
  }
}

export async function runForge(input: RunForgeInput): Promise<RunForgeResult> {
  const { config, trace, sandbox } = input

  const deps: OrchestratorDeps = {
    sandbox,
    trace,
    lcModel: buildLcModel(config),
    textModel: buildTextModel(config),
    buildCommand: input.buildCommand,
    testCommand: input.testCommand,
    skipBuild: input.skipBuild,
    compileStrategy: input.compileStrategy,
  }

  const graph = buildOrchestratorGraph(deps)

  // 文件型 checkpointer：落 runs/<runId>/checkpoints.db，支持崩溃续跑
  const checkpointer = new WorkspaceCheckpointer({
    dbPath: join(input.runsRoot, input.runId, 'checkpoints.db'),
  })

  const compiled = graph.compile({ checkpointer })
  const threadId = `forge-${input.runId}`

  const initialState = {
    runId: input.runId,
    workspacePath: sandbox.workspacePath,
    requirementPath: input.requirementPath,
    requirementText: input.requirementText ?? '',
    budget: config.budget,
    startedAt: Date.now(),
  }

  await trace.emit('run_start', {
    name: 'forge',
    payload: {
      runId: input.runId,
      resume: !!input.resume,
      compileStrategy: input.compileStrategy ?? 'sections',
      skipBuild: !!input.skipBuild,
    },
  })

  const finalState = await compiled.invoke(initialState, {
    configurable: { thread_id: threadId },
    recursionLimit: config.budget.maxSteps + 10,
  })

  checkpointer.close()

  const result: RunForgeResult = {
    status: finalState.status === 'done' ? 'done' : 'aborted',
    finalSummary: finalState.finalSummary ?? '',
    failedTasks: finalState.failedTasks ?? [],
  }

  await trace.emit('run_end', {
    name: 'forge',
    payload: {
      status: result.status,
      failedTasks: result.failedTasks,
      totalTokens: finalState.tokenUsage?.total?.totalTokens ?? 0,
      steps: finalState.steps,
    },
  })

  return result
}
