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
