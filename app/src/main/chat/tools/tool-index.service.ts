import { Inject, Injectable } from '@electrum/common'
import type { RouteDecision } from '@chatvein/common'
import { emitTelemetry } from '@chatvein/observability'
import {
  resolveChatTools,
  parseMcpServersJson,
  ToolVectorIndex,
  llmSelectTools,
  fitToolsWithinBudget,
  computeToolBudgetTokens,
  keywordSelect,
  catalogEntryForTool,
  humanizeToolName,
  TOOL_INDEX_SCOPE,
  TOOL_INDEX_KIND,
  TOOL_PRESCREEN_TOP_K,
  selectStateFilesystemCatalogEntries,
  normalizeStateFilesystemAllowlist,
  isStateFilesystemToolId,
  stateFilesystemIndexInputs,
  type ToolEmbedder,
  type ToolVectorStore,
  type LlmSelectToolsStatus,
  type ToolCatalogEntry,
  type StateFilesystemToolName,
  type StructuredToolInterface,
} from '@chatvein/tools'
import { app } from 'electron'
import { isAbsolute, join } from 'node:path'
import type { AgentConfig } from '../../agent/agent.types'
import type { ModelConfig } from '../../model/model.types'
import { SettingsService } from '../../settings/settings.service'
import { CODER_AGENT_ID } from '../constants'
import { formatToolSelectorLabel } from '../turn/office-helpers'
import { ChatLlmHelper } from '../turn/llm'
import {
  toolIndexMetaFile,
  toolIndexSignature,
  ToolIndexMetaStore,
  type ToolIndexMeta,
} from './tool-index-meta'

/**
 * 工具向量索引 + 绑定链路（C1 预筛 → C2 弱模精筛 → C3 预算裁剪）。
 * 索引维护仅在启动 warmup / `refreshToolIndex`；对话路径只读检索。
 */
@Injectable()
export class ToolIndexService {
  @Inject(SettingsService)
  private settings!: SettingsService

  @Inject(ChatLlmHelper)
  private llm!: ChatLlmHelper

  private toolIndex: ToolVectorIndex | null = null
  private toolIndexInit: Promise<ToolVectorIndex | null> | null = null
  /** 索引维护串行队列（warmup 全量 + MCP/配置变更 sync，避免并发写库/写 meta） */
  private toolIndexOps: Promise<unknown> = Promise.resolve()
  /** 启动 warmup 一次性标记（幂等） */
  private toolIndexWarmup: Promise<void> | null = null
  /** 索引元信息内存缓存（index-meta.json 读一次，避免每轮磁盘 IO） */
  private toolIndexMetaCache: ToolIndexMeta | null = null
  private readonly toolIndexMetaStore = new ToolIndexMetaStore(
    toolIndexMetaFile(join(app.getPath('userData'), 'forge', 'vector')),
  )
  /** 语义预筛召回上限（粗召回给 L2 精筛）；与 `@chatvein/tools` 常量对齐 */
  private readonly toolPrescreenTopK = TOOL_PRESCREEN_TOP_K
  /** L2 弱模型精筛上限 */
  private readonly toolSelectTopK = 10
  /** 候选 ≤ 此数跳过弱模型（省延迟） */
  private readonly toolSelectSkipBelow = 10

  /**
   * 解析本轮工具的 jail 根目录。
   * - 群组编码角色（内置 coder Agent）且设置了 `devProjectRoot`：文件读写 / 脚本执行
   *   等工具的根切换为用户真实项目目录；
   * - 单对话「编程开发」档走 Forge，不经此路径；其余回落到会话私有工作区（沙箱）。
   * 返回 toolRoot（传给工具层）与 projectRoot（非空表示正处于项目模式，用于注入提示）。
   */
  async resolveToolRoot(
    agent: AgentConfig,
    conversationWorkspace: string,
  ): Promise<{ toolRoot: string; projectRoot: string }> {
    const isCodingAgent = agent.id === CODER_AGENT_ID
    if (!isCodingAgent) return { toolRoot: conversationWorkspace, projectRoot: '' }
    const settings = await this.settings.get()
    const projectRoot = settings.devProjectRoot?.trim() ?? ''
    if (projectRoot && isAbsolute(projectRoot)) {
      return { toolRoot: projectRoot, projectRoot }
    }
    return { toolRoot: conversationWorkspace, projectRoot: '' }
  }

  /**
   * policy.tools ∩ 角色白名单 → LangChain 工具 + StateBackend FS allowlist。
   * 链路：resolveChatTools + FS 目录 → C1 混合预筛 → C2 弱模型精筛 → C3 预算裁剪（仅 StructuredTool）。
   * query 应为 `route.rewrittenQuery ?? 原文`；**空 query → 不绑工具**（主模型纯聊）。
   * workspaceRoot 为工具 jail 根：编程模式下是用户项目目录，否则是会话沙箱。
   */
  async resolveBoundTools(
    agent: AgentConfig,
    toolPolicy: RouteDecision['policy']['tools'],
    workspaceRoot?: string,
    query?: string,
    model?: ModelConfig,
  ): Promise<{
    tools: StructuredToolInterface[]
    /** null = 本轮不挂 filesystem middleware */
    filesystemTools: StateFilesystemToolName[] | null
  }> {
    const q = query?.trim() ?? ''
    // 无检索句无法做 C1/C2；不强行全量绑工具，避免空白输入拖进整库工具
    if (!q) return { tools: [], filesystemTools: null }

    const settings = await this.settings.get()
    const wsRoot = workspaceRoot?.trim() || settings.effectiveWorkspaceRoot
    const allowIds = agent.tools.length > 0 ? agent.tools : 'all'
    const candidateTools = await resolveChatTools({
      policy: toolPolicy,
      allowIds,
      workspaceRoot: wsRoot,
      secrets: {
        serpApiKey: process.env.SERPAPI_API_KEY,
        braveApiKey: process.env.BRAVE_SEARCH_API_KEY,
        tavilyApiKey: process.env.TAVILY_API_KEY,
        wolframAppId: process.env.WOLFRAM_ALPHA_APPID,
      },
      mcpServers: parseMcpServersJson(process.env.CHATVEIN_MCP_SERVERS),
    })

    const fsCatalog = selectStateFilesystemCatalogEntries({
      policy: toolPolicy,
      allowIds,
      workspaceRoot: wsRoot,
    })

    const byName = new Map(candidateTools.map((t) => [t.name, t]))
    const structuredNames = [...byName.keys()]
    const fsNames = fsCatalog.map((e) => e.id)
    const candidateNames = [...new Set([...structuredNames, ...fsNames])]
    if (candidateNames.length === 0) return { tools: [], filesystemTools: null }

    // 等待启动 warmup（若仍在跑），避免签名命中跳过写库后内存未 ready 导致本轮空召回
    await this.awaitToolIndexWarmup()

    // 层 C1：向量+BM25 混合预筛；未就绪/空命中 → 关键词兜底；再空 → 全候选
    let c1Source: 'hybrid' | 'keyword' | 'full' = 'full'
    let narrowed = candidateNames
    const hybridHits = await this.prescreenWithVector(q, candidateNames)
    if (hybridHits.length > 0) {
      narrowed = hybridHits
      c1Source = 'hybrid'
    } else {
      const kwHits = this.prescreenWithKeywords(q, candidateTools, fsCatalog)
      if (kwHits.length > 0 && kwHits.length < candidateNames.length) {
        narrowed = kwHits
        c1Source = 'keyword'
      }
    }

    // 层 C2：弱模型精筛（候选已很少则跳过）
    let finalNames = narrowed
    let c2Status: LlmSelectToolsStatus | 'skipped' = 'skipped'
    if (model && narrowed.length > this.toolSelectSkipBelow) {
      const c2 = await this.llmSelectToolsForTurn(q, narrowed, candidateTools, fsCatalog, model)
      finalNames = c2.toolIds
      c2Status = c2.status
    }

    const filesystemTools = normalizeStateFilesystemAllowlist(finalNames)
    const structuredFinal = finalNames.filter((n) => !isStateFilesystemToolId(n))

    // 层 C3 预算裁剪（仅 StructuredTool；FS 走 middleware，不占此预算）
    const ordered = structuredFinal
      .map((n) => byName.get(n))
      .filter((t): t is StructuredToolInterface => Boolean(t))
    const toolBudgetTokens = computeToolBudgetTokens({ modelId: model?.model })
    const bound = fitToolsWithinBudget(ordered, toolBudgetTokens)

    this.emitToolSelectionTelemetry(bound, {
      selector: formatToolSelectorLabel(c1Source, c2Status),
      candidateCount: candidateNames.length,
      narrowedCount: narrowed.length,
      c1: c1Source,
      c2: c2Status,
      queryChars: q.length,
      indexReady: Boolean(this.toolIndex?.ready),
      toolBudgetTokens,
      filesystemTools: filesystemTools ?? [],
    })
    return { tools: bound, filesystemTools }
  }

  /** App ready 后后台预建工具索引：版本化全量基准（幂等、失败仅告警，不阻塞窗口） */
  warmupInBackground(): void {
    void this.warmupToolIndex().catch((e) =>
      console.warn('[ChatService] tool index warmup failed', e),
    )
  }

  /**
   * MCP 菜单 / 环境变量变更后调用：相对已同步名差量 upsert。
   * 对话路径不再每轮 sync；工具集只在启动与配置变更时维护。
   */
  async refreshToolIndex(): Promise<void> {
    const tools = await this.resolveSystemTools()
    await this.syncToolIndex(tools)
  }

  /** 懒加载 @chatvein/vector（原生模块不进主 bundle 静态图），建好 ToolVectorIndex 单例 */
  private async ensureToolIndex(): Promise<ToolVectorIndex | null> {
    if (this.toolIndex) return this.toolIndex
    if (this.toolIndexInit) return this.toolIndexInit
    this.toolIndexInit = (async () => {
      try {
        const vector = await import('@chatvein/vector')
        const embedder: ToolEmbedder = vector.createBgeZhEmbedder({
          cacheDir: this.hfCacheDir(),
          // 国内直连 huggingface.co 易超时；可用 HF_ENDPOINT / CHATVEIN_HF_ENDPOINT 覆盖
          remoteHost:
            process.env.CHATVEIN_HF_ENDPOINT?.trim() ||
            process.env.HF_ENDPOINT?.trim() ||
            'https://hf-mirror.com/',
        })
        const localStore = vector.createLocalVectorStore({
          dataDir: this.toolIndexDataDir(),
          embedder,
          tableName: 'tool_index',
        })
        const store: ToolVectorStore = {
          upsert: (records) => localStore.upsert(records as never),
          search: (q, options) =>
            localStore
              .search(q, {
                topK: options?.topK,
                queryEmbedding: options?.queryEmbedding,
                filter: { scope: TOOL_INDEX_SCOPE, kind: TOOL_INDEX_KIND },
              })
              .then((hits) => hits.map((h) => ({ id: h.id, score: h.score, meta: h.meta }))),
          remove: (ids) => localStore.remove(ids),
        }
        this.toolIndex = new ToolVectorIndex({
          embedder,
          store,
          prescreenTopK: this.toolPrescreenTopK,
        })
        return this.toolIndex
      } catch (e) {
        console.warn('[ChatService] vector index unavailable, tools fallback to keyword/full', e)
        this.toolIndexInit = null
        return null
      }
    })()
    return this.toolIndexInit
  }

  /** 索引维护串行化：warmup 全量与配置变更 sync 共享，避免并发写库 / 写 meta */
  private enqueueToolIndexOp<T>(op: () => Promise<T>): Promise<T> {
    const run = this.toolIndexOps.then(op, op)
    this.toolIndexOps = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  private async readToolIndexMeta(): Promise<ToolIndexMeta> {
    if (!this.toolIndexMetaCache) {
      this.toolIndexMetaCache = await this.toolIndexMetaStore.read()
    }
    return this.toolIndexMetaCache
  }

  private async writeToolIndexMeta(meta: ToolIndexMeta): Promise<void> {
    this.toolIndexMetaCache = meta
    await this.toolIndexMetaStore.write(meta)
  }

  /**
   * 启动 warmup（版本化基准）：
   * 解析系统工具全集 → 对入库记录求内容签名；与上次一致且无下线 → 仅 markReady（零写入）；
   * 否则全量覆盖 upsert + 清理下线记录 + 写回 meta。
   */
  private warmupToolIndex(): Promise<void> {
    if (!this.toolIndexWarmup) {
      this.toolIndexWarmup = this.enqueueToolIndexOp(async () => {
        const idx = await this.ensureToolIndex()
        if (!idx) return
        const tools = await this.resolveSystemTools()
        if (tools.length === 0) return
        const records = idx.recordsFor(this.toolIndexInputsOf(tools))
        const signature = toolIndexSignature(records)
        const meta = await this.readToolIndexMeta()
        const stale = (meta.syncedNames ?? []).filter((n) => !records.some((r) => r.id === n))
        if (meta.builtinSignature === signature && stale.length === 0) {
          // 磁盘已有有效快照；必须标记进程内 ready，否则 C1 永远空召回
          idx.markReady(this.toolIndexInputsOf(tools))
          console.debug(
            `[tool-index] warmup skip (sig match) records=${records.length} ready=true lexical=${idx.lexicalSize}`,
          )
          return
        }
        console.debug(
          `[tool-index] warmup rebuild sig=${signature.slice(0, 8)} records=${records.length} stale=${stale.length}`,
        )
        await idx.replace(this.toolIndexInputsOf(tools))
        if (stale.length > 0) await idx.purge(stale)
        await this.writeToolIndexMeta({
          builtinSignature: signature,
          syncedNames: records.map((r) => r.id),
          updatedAt: Date.now(),
        })
      })
    }
    return this.toolIndexWarmup
  }

  /** 对话预筛前等待 warmup（失败也继续，走关键词/全量回退） */
  private async awaitToolIndexWarmup(): Promise<void> {
    if (this.toolIndex?.ready) return
    if (!this.toolIndexWarmup) {
      // 极早消息：主动触发一次 warmup，避免永远不 ready
      void this.warmupToolIndex().catch((e) =>
        console.warn('[ChatService] tool index warmup failed', e),
      )
    }
    if (this.toolIndexWarmup) {
      try {
        await this.toolIndexWarmup
      } catch {
        // 已在 onAppReady / 上方告警
      }
    }
  }

  /**
   * 配置变更差量同步：相对 meta.syncedNames 仅补录新增工具（upsert）。
   * 不做删除（agent 白名单收窄误删有风险）；下线收敛到启动 warmup。
   */
  private syncToolIndex(candidates: StructuredToolInterface[]): Promise<void> {
    return this.enqueueToolIndexOp(async () => {
      const idx = await this.ensureToolIndex()
      if (!idx || candidates.length === 0) return
      const meta = await this.readToolIndexMeta()
      const known = new Set(meta.syncedNames ?? [])

      if (!idx.ready) {
        await idx.build(this.toolIndexInputsOf(candidates))
        const names = new Set<string>(meta.syncedNames ?? [])
        candidates.forEach((t) => names.add(t.name))
        await this.writeToolIndexMeta({
          ...meta,
          syncedNames: [...names],
          updatedAt: Date.now(),
        })
        return
      }

      const fresh = candidates.filter((t) => !known.has(t.name))
      if (fresh.length === 0) return
      const records = idx.recordsFor(this.toolIndexInputsOf(fresh))
      if (records.length === 0) return
      await idx.sync(records)
      const names = new Set<string>(known)
      records.forEach((r) => names.add(r.id))
      await this.writeToolIndexMeta({ ...meta, syncedNames: [...names], updatedAt: Date.now() })
    })
  }

  /** warmup / refresh 用的系统工具全集：policy full + 无白名单 */
  private async resolveSystemTools(): Promise<StructuredToolInterface[]> {
    const settings = await this.settings.get()
    return resolveChatTools({
      policy: 'full',
      allowIds: 'all',
      workspaceRoot: settings.effectiveWorkspaceRoot?.trim() || undefined,
      secrets: {
        serpApiKey: process.env.SERPAPI_API_KEY,
        braveApiKey: process.env.BRAVE_SEARCH_API_KEY,
        tavilyApiKey: process.env.TAVILY_API_KEY,
        wolframAppId: process.env.WOLFRAM_ALPHA_APPID,
      },
      mcpServers: parseMcpServersJson(process.env.CHATVEIN_MCP_SERVERS),
    })
  }

  private toolIndexInputsOf(
    tools: StructuredToolInterface[],
  ): Array<{ name: string; description?: string; schema?: unknown }> {
    const fromTools = tools.map((t) => ({
      name: t.name,
      description: t.description,
      schema: (t as { schema?: unknown }).schema,
    }))
    // StateBackend FS 目录条目一并进索引（无 StructuredTool 实例）
    const fromFs = stateFilesystemIndexInputs()
    const seen = new Set(fromTools.map((t) => t.name))
    return [...fromTools, ...fromFs.filter((f) => !seen.has(f.name))]
  }

  /** 层 C1：向量+工具名/别名 BM25 混合预筛；未就绪/失败 → []（由上层改走关键词或全量） */
  private async prescreenWithVector(query: string, candidateNames: string[]): Promise<string[]> {
    const idx = this.toolIndex
    if (!idx?.ready) return []
    try {
      return await idx.select(query, candidateNames, this.toolPrescreenTopK)
    } catch (e) {
      console.warn('[ChatService] tool vector prescreen failed', e)
      return []
    }
  }

  /** 层 C1 兜底：关键词预筛；无命中（返回全集）视为无效，交给上层全量 */
  private prescreenWithKeywords(
    query: string,
    tools: StructuredToolInterface[],
    fsCatalog: ToolCatalogEntry[],
  ): string[] {
    const entries: ToolCatalogEntry[] = [
      ...tools.map((t) => {
        const cat = catalogEntryForTool(t.name)
        if (cat) return cat
        const human = humanizeToolName(t.name)
        return {
          id: t.name,
          category: 'knowledge' as const,
          title: human || t.name,
          description: t.description ?? '',
          source: 'runtime',
          defaultEnabled: true,
          keywords: human.split(/\s+/).filter(Boolean),
        }
      }),
      ...fsCatalog,
    ]
    return keywordSelect(query, entries)
  }

  /** 层 C2：复用 L2 弱模型通道精筛 */
  private async llmSelectToolsForTurn(
    query: string,
    narrowedNames: string[],
    candidates: StructuredToolInterface[],
    fsCatalog: ToolCatalogEntry[],
    model: ModelConfig,
  ): Promise<{ toolIds: string[]; status: LlmSelectToolsStatus }> {
    const byName = new Map(candidates.map((t) => [t.name, t]))
    const byFs = new Map(fsCatalog.map((e) => [e.id, e]))
    const cand = narrowedNames
      .map((n) => {
        const t = byName.get(n)
        if (t) return { name: t.name, description: t.description }
        const fs = byFs.get(n)
        if (fs) return { name: fs.id, description: fs.description }
        return null
      })
      .filter((x): x is { name: string; description: string } => Boolean(x))
    try {
      const l2Model = await this.llm.resolveL2Model(model)
      const llmWeak = this.llm.createDebugAwareLlm(l2Model, { temperature: 0, maxTokens: 256 })
      return await llmSelectTools(query, cand, llmWeak, {
        maxK: this.toolSelectTopK,
        timeoutMs: 10_000,
      })
    } catch (e) {
      console.warn('[ChatService] llmSelectTools failed, fallback narrowed', e)
      return { toolIds: narrowedNames, status: 'fallback_error' }
    }
  }

  /**
   * 工具选用埋点：真实 C1/C2 路径，而非「索引 ready 即 vector+l2」。
   * 走统一遥测通道（事件名 `trace:tool_select`），业务字段挂 payload，
   * 可跨 run 聚合用于调参（lexicalWeight / rrfK / toolBudgetTokens）。
   */
  private emitToolSelectionTelemetry(
    bound: StructuredToolInterface[],
    info: {
      selector: string
      candidateCount: number
      narrowedCount: number
      c1: string
      c2: string
      queryChars: number
      indexReady: boolean
      toolBudgetTokens?: number
      filesystemTools?: string[]
    },
  ): void {
    emitTelemetry('trace:tool_select', {
      selector: info.selector,
      c1: info.c1,
      c2: info.c2,
      candidateCount: info.candidateCount,
      narrowedCount: info.narrowedCount,
      boundCount: bound.length,
      indexReady: info.indexReady,
      queryChars: info.queryChars,
      ...(info.toolBudgetTokens != null ? { toolBudgetTokens: info.toolBudgetTokens } : {}),
      ...(info.filesystemTools ? { filesystemTools: info.filesystemTools } : {}),
      tools: bound.map((t) => t.name),
    })
  }

  private toolIndexDataDir(): string {
    return join(app.getPath('userData'), 'forge', 'vector')
  }

  private hfCacheDir(): string {
    return join(app.getPath('userData'), 'forge', 'hf-cache')
  }
}
