/**
 * agentic · domain → worker 分发。
 *
 * 仅两个角色：general（通用）/ code（编码）。办公文档归 general。
 */
import type { Domain } from '../../types'

export type AgenticWorkerName = 'react_chat' | 'coder_task'

/** 把历史 `office` 等别名收口到 general | code */
export function normalizeWorkerDomain(domain: Domain | undefined): 'general' | 'code' {
  if (domain === 'code') return 'code'
  return 'general'
}

export function dispatchAgenticWorker(
  domain: Domain | undefined,
): AgenticWorkerName {
  return normalizeWorkerDomain(domain) === 'code' ? 'coder_task' : 'react_chat'
}

/** @deprecated 使用 dispatchAgenticWorker */
export const dispatchStandardWorker = dispatchAgenticWorker
