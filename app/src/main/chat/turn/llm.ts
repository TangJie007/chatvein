import { Inject, Injectable } from '@electrum/common'
import { createL2Classifier, getDefaultHeuristicRouter } from '@chatvein/agents'
import { createLangChainChatModel } from '@chatvein/models'
import {
  isTelemetryEnabled,
  setTelemetryContext,
  setTelemetrySink,
  toIpcSafePayload,
  type TelemetryEvent,
} from '@chatvein/observability'
import { ModelService } from '../../model/model.service'
import type { ModelConfig } from '../../model/model.types'
import type { ChatStreamEvent } from '../chat.types'

/**
 * L2 / ReAct / 遥测共用的 LLM 与路由辅助。
 * ToolIndexService / ShortTermMemory 也依赖 createDebugAwareLlm + resolveL2Model。
 */
@Injectable()
export class ChatLlmHelper {
  @Inject(ModelService)
  private models!: ModelService

  /** 已为该模型 id 注入过 Structured L2，避免每轮重建 */
  private l2BoundModelId: string | null = null

  /**
   * 确保默认路由器挂上 Structured L2。
   * 一期无独立 weak 模型表：优先名称含 flash/mini/turbo/haiku/lite 的已启用模型，否则用当前对话模型（低温短输出）。
   */
  async routerWithL2(agentModel: ModelConfig) {
    const l2Model = await this.resolveL2Model(agentModel)
    const router = getDefaultHeuristicRouter()
    if (this.l2BoundModelId === l2Model.id) return router

    const llm = this.createDebugAwareLlm(l2Model, {
      temperature: 0,
      maxTokens: 256,
    })
    router.setL2(createL2Classifier({ model: llm, timeoutMs: 12_000 }))
    this.l2BoundModelId = l2Model.id
    return router
  }

  /**
   * 本轮请求期内挂上遥测 sink + 上下文；L2 / ReAct / 工具选用共用同一通道。
   * - sink：把事件经 IPC 推渲染进程 console.log（落在哪由业务决定，现阶段即此）。
   * - 上下文：自动给每个事件补 traceId=runId 与 conversationId，业务字段仍在 payload。
   * 返回清理函数（finally 调用）。
   */
  beginRequestTelemetry(
    emit: ((evt: ChatStreamEvent) => void) | undefined,
    runId: string,
    conversationId: string,
  ): (() => void) | undefined {
    if (!isTelemetryEnabled() || !emit) return undefined
    const clearSink = setTelemetrySink((event) => {
      this.forwardTelemetry(emit, event)
    })
    const clearContext = setTelemetryContext({
      traceId: runId,
      attrs: { conversationId },
    })
    return () => {
      clearContext()
      clearSink()
    }
  }

  /** 把遥测事件收成 IPC 安全数据并推给渲染进程 */
  forwardTelemetry(
    emit: ((evt: ChatStreamEvent) => void) | undefined,
    event: TelemetryEvent,
  ): void {
    if (!emit) return
    try {
      emit({
        type: 'telemetry',
        event: toIpcSafePayload(event) as TelemetryEvent,
      })
    } catch {
      // ignore
    }
  }

  /**
   * 构建 LangChain 模型。遥测探针（`llm:*`）在桥接层始终挂载、无状态且异步发送，
   * 是否落地由遥测开关/sink 决定；L2 模型缓存后也能在开关打开时逐步输出。
   */
  createDebugAwareLlm(
    model: ModelConfig,
    opts: { temperature?: number; maxTokens?: number },
  ) {
    return createLangChainChatModel({
      id: model.id,
      baseUrl: model.baseUrl,
      apiKey: model.apiKey,
      model: model.model,
      temperature: opts.temperature ?? model.temperature,
      maxTokens: opts.maxTokens,
    })
  }

  /**
   * 为 L2 语义路由挑选弱模：优先名称含 flash/mini/turbo/haiku/lite/small 的已启用模型；
   * 否则回退到当前对话模型（与主 ReAct 解耦，仅作路由分类/改写，不回答用户）。
   */
  async resolveL2Model(agentModel: ModelConfig): Promise<ModelConfig> {
    const list = await this.models.list()
    const weakish = list.find(
      (m) =>
        m.enabled &&
        m.baseUrl?.trim() &&
        m.model?.trim() &&
        /flash|mini|turbo|haiku|lite|small/i.test(`${m.name} ${m.model}`),
    )
    return weakish ?? agentModel
  }
}
