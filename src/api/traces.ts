import { backendRequest } from "./client";

export interface TraceUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cached_tokens?: number;
  reasoning_tokens?: number;
  context_pct?: number;
}

export interface TraceTotals extends TraceUsage {
  llm_calls: number;
  tool_calls: number;
  llm_ms?: number;
  tool_ms?: number;
  /** 金额估算：只有模型里填了单价才有（后端 `agents/cost.py` 算）。 */
  cost_amount?: number;
  currency?: string;
}

export interface TraceInvocation {
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  stop?: unknown;
  response_format?: string;
  max_retries?: number;
  tools?: Array<{ name: string; description?: string }>;
}

export interface TraceErrorDetail {
  message?: string;
  status_code?: number;
  request_id?: string;
  /** 错误码（`backend/errors.py` 码表）：让「同一个原因」在多次失败里可聚合。 */
  code?: string;
}

export interface TraceMessage {
  role: string;
  content: string;
  name?: string;
  tool_calls?: Array<{ id?: string | null; name: string; args: unknown }>;
}

export interface TraceStep {
  id: string;
  parent_id?: string | null;
  kind: "llm" | "tool" | "route" | "tools" | "span" | string;
  name: string;
  status: string;
  model?: string | null;
  start_ms?: number | null;
  elapsed_ms?: number | null;
  usage?: TraceUsage | null;
  invocation?: TraceInvocation | null;
  request?: { messages: TraceMessage[] } | null;
  response?: { content: string; tool_calls?: TraceMessage["tool_calls"] } | null;
  arguments?: unknown;
  result?: string | null;
  error?: string | null;
  error_detail?: TraceErrorDetail | null;
  detail?: Record<string, unknown> | null;
}

export interface TracePathNode {
  id: string;
  label: string;
  taken: boolean;
}

export interface TraceSummary {
  turn_id: string;
  created_at: string;
  status?: string;
  input: string;
  difficulty: string;
  elapsed_ms: number;
  role_name?: string | null;
  model_name?: string | null;
  selected_tools: string[];
  totals: TraceTotals;
}

export interface TurnTrace extends TraceSummary {
  input: string;
  started_at: string;
  finished_at: string;
  rewritten: string;
  route_reason: string;
  role_id?: string | null;
  config_name?: string | null;
  model_config_id?: string | null;
  context_window?: number | null;
  candidate_tools: string[];
  tool_plan_reason: string;
  reply: string;
  /** 提示词版本（`backend/agents/prompt_registry.py`）：id → 8 位版本号。 */
  prompts?: Record<string, string> | null;
  /** 本轮是否降级过备用模型；非空时面板顶部要给提示，否则用户会拿降级结果排查主模型。 */
  model_fallback?: {
    from_config: string;
    to_config: string;
    code: string;
  } | null;
  /** 单轮预算账本（`backend/agents/cost.py`）；没配预算时 token_limit 为 0。 */
  budget?: {
    token_limit: number;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    llm_calls: number;
    curtailed: boolean;
  } | null;
  path: TracePathNode[];
  steps: TraceStep[];
}

/** 会话里每一轮的追踪摘要，最新的在前。 */
export async function listTraces(conversationId: string) {
  const data = await backendRequest<{ traces: TraceSummary[] }>(
    `/api/conversations/${conversationId}/traces`
  );
  return data.traces;
}

/** 一轮的完整追踪：图路径、每次 LLM 请求/响应、工具与 token。 */
export function getTrace(conversationId: string, turnId: string) {
  return backendRequest<TurnTrace>(
    `/api/conversations/${conversationId}/traces/${turnId}`
  );
}

export interface MetricsOverall {
  turns: number;
  done: number;
  cancelled: number;
  error: number;
  running: number;
  success_rate: number;
  cancel_rate: number;
  error_rate: number;
  avg_elapsed_ms: number;
  p95_elapsed_ms: number;
  avg_tokens: number;
  p95_tokens: number;
  llm_calls: number;
  tool_calls: number;
  tool_failures?: number;
  tool_failure_rate?: number | null;
}

export interface MetricsDay {
  date: string;
  turns: number;
  done: number;
  error: number;
  cancelled: number;
  success_rate: number;
  avg_tokens: number;
  p95_tokens: number;
  avg_elapsed_ms: number;
}

export interface MetricsAlert {
  code: string;
  level: "warn" | "critical" | string;
  value: number;
  message: string;
}

export interface MetricsToolRow {
  tool: string;
  calls: number;
  failures: number;
}

/** 会话健康度：窗口内成功率、token / 耗时分布、工具失败率与告警。 */
export interface ConversationMetrics {
  schema_version: number;
  generated_at: string;
  window_days: number;
  overall: MetricsOverall;
  by_day: MetricsDay[];
  by_difficulty: Array<{
    difficulty: string;
    turns: number;
    success_rate: number;
    avg_tokens: number;
  }>;
  tool_by_name: MetricsToolRow[];
  alerts: MetricsAlert[];
}

/** 与后端 `backend/trace/metrics.py::DEFAULT_WINDOW_DAYS` 保持一致。 */
const METRICS_WINDOW_DAYS = 14;

export function getConversationMetrics(conversationId: string, days = METRICS_WINDOW_DAYS) {
  return backendRequest<ConversationMetrics>(
    `/api/conversations/${conversationId}/metrics?days=${days}`
  );
}
