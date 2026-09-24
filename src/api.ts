import { invoke } from "@tauri-apps/api/core";
// Native fetch provided by Tauri's HTTP plugin: the request is executed in Rust
// (reqwest), so browser CORS does not apply and no CSP connect-src is needed.
import { fetch } from "@tauri-apps/plugin-http";

/**
 * The Rust layer launches the Python backend and, at startup, hands the
 * frontend the real base URL (including the dynamically chosen port). The
 * React UI then talks to Python *directly* via fetch — Rust is no longer a
 * per-request proxy, it is just the process / URL provider and event bridge.
 */

let cachedUrl: string | null = null;
/** Set when Rust emits `backend-ready` (or a successful health poll). */
let backendReady = false;

/** Cache URL from the Rust `backend-ready` event so later requests skip cold start. */
export function markBackendReady(url: string): void {
  cachedUrl = url;
  backendReady = true;
}

/** Rust pushes the real backend URL at startup; this caches it. */
export async function getBackendUrl(): Promise<string> {
  if (cachedUrl) return cachedUrl;
  try {
    cachedUrl = await invoke<string>("backend_url");
  } catch {
    // Browser preview without Tauri — assume the fixed dev port.
    cachedUrl = "http://127.0.0.1:8420";
  }
  return cachedUrl;
}

/** Wait until the Python backend is actually listening (polls /api/health). */
export async function waitForBackend(timeoutMs = 20000): Promise<string> {
  if (backendReady && cachedUrl) return cachedUrl;
  const url = await getBackendUrl();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (backendReady && cachedUrl) return cachedUrl;
    try {
      const r = await fetch(`${url}/api/health`);
      if (r.ok) {
        markBackendReady(url);
        return url;
      }
    } catch {
      // not up yet — keep polling
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("Python 后端在限定时间内未就绪");
}

/** Direct fetch to the Python backend (frontend talks to it straight). */
export async function backendRequest<T = unknown>(
  endpoint: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" = "GET",
  body?: unknown,
  signal?: AbortSignal | null
): Promise<T> {
  const url = await waitForBackend();
  try {
    const res = await fetch(`${url}${endpoint}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: signal ?? undefined,
    });
    const text = await res.text();
    let data: unknown = text;
    try {
      data = JSON.parse(text);
    } catch {
      /* keep raw text when not JSON */
    }
    if (!res.ok) {
      throw new Error(httpErrorMessage(res.status, text));
    }
    return data as T;
  } catch (err) {
    // Tauri plugin-http：Rust 抛 string "Request canceled"；JS 侧为 "Request cancelled"。
    if (signal?.aborted || isHttpAbort(err)) {
      const abortErr = new DOMException("Request cancelled", "AbortError");
      throw abortErr;
    }
    throw err;
  }
}

/** 非 2xx：优先取 FastAPI 的 ``detail``（或 message），避免只显示裸 JSON / 状态码。 */
function httpErrorMessage(status: number, text: string): string {
  let detail = text;
  try {
    const parsed = JSON.parse(text) as { detail?: unknown; message?: unknown };
    if (typeof parsed?.detail === "string") detail = parsed.detail;
    else if (Array.isArray(parsed?.detail)) detail = parsed.detail.map(String).join("；");
    else if (typeof parsed?.message === "string") detail = parsed.message;
  } catch {
    /* 非 JSON：保留原文 */
  }
  const body = detail.trim();
  return body ? `请求失败（${status}）：${body}` : `请求失败（${status}）`;
}

function isHttpAbort(err: unknown): boolean {
  if (err instanceof DOMException && err.name === "AbortError") return true;
  if (err instanceof Error && err.name === "AbortError") return true;
  const msg =
    typeof err === "string"
      ? err
      : err instanceof Error
        ? err.message
        : err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : String(err);
  const lower = msg.toLowerCase();
  return lower.includes("request canceled") || lower.includes("request cancelled");
}

/** Lightweight health check against the Python backend. */
export async function backendHealth() {
  return backendRequest<{
    status: string;
    service: string;
    python: string;
    db: DbInfo;
  }>("/api/health");
}

/* -------------------------------------------------------------------------
 * SQLite persistence (backend/db.py)
 * ---------------------------------------------------------------------- */

export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessageRecord {
  id: number;
  conversation_id: string;
  role: ChatRole;
  content: string;
  used_llm: boolean;
  route: string | null;
  created_at: string;
  turn_id?: string | null;
  tokens?: number | null;
  duration_ms?: number | null;
  /** 执行者角色 id：群组 @ 指派时标识由哪个成员回复 */
  actor_id?: string | null;
}

export interface ConversationRecord {
  id: string;
  title: string;
  workspace_dir: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  last_message: string | null;
  /** 会话级技能 slug 列表：Composer 勾选，当前会话内持续生效。 */
  skills?: string[];
}

export interface DbVectorInfo {
  loaded: boolean;
  version: string | null;
  error: string | null;
}

export interface DbInfo {
  path: string;
  exists: boolean;
  schema_version: number;
  conversations: number;
  messages: number;
  journal_mode: string;
  sqlite_version: string;
  size_bytes: number;
  logical_bytes: number;
  page_count: number;
  free_pages: number;
  vector_extension: DbVectorInfo;
}

export interface DbTableSummary {
  name: string;
  type: "table" | "view" | string;
  row_count: number | null;
  sql: string;
}

export interface DbColumnInfo {
  cid: number;
  name: string;
  type: string | null;
  notnull: boolean;
  default: string | null;
  pk: boolean;
}

export interface DbTableDetail {
  name: string;
  type: string;
  sql: string;
  columns: DbColumnInfo[];
  total: number | null;
  limit: number;
  offset: number;
  rows: Record<string, unknown>[];
}

export interface WorkspaceInfo {
  path: string;
  label: string;
  custom: boolean;
}

/** 当前主空间（文件工具沙箱根）。 */
export function getWorkspace() {
  return backendRequest<WorkspaceInfo>("/api/workspace");
}

/** 把主空间切到用户选择的本机文件夹。 */
export function setWorkspace(path: string) {
  return backendRequest<WorkspaceInfo>("/api/workspace", "PUT", { path });
}

/** 清除自选目录，回到默认主空间。 */
export function resetWorkspace() {
  return backendRequest<WorkspaceInfo>("/api/workspace", "DELETE");
}

export interface UploadResultFile {
  name?: string;
  path?: string;
  error?: string;
}

/** 把本机文件（拖入/选择的绝对路径，或 base64 内容）落盘到主空间 uploads/，
 *  返回工作区内相对路径，供 OCR / 文件工具解析（沙箱外绝对路径无法被 Agent 读取）。 */
export function uploadFiles(
  files: Array<{ source_path: string } | { content_base64: string; name: string }>,
  conversationId?: string | null
) {
  return backendRequest<{ files: UploadResultFile[] }>("/api/uploads", "POST", {
    files,
    conversation_id: conversationId ?? null,
  });
}

/** Database file location, schema version and row counts. */
export function dbInfo() {
  return backendRequest<DbInfo>("/api/db/info");
}

/** VACUUM the database and return the refreshed stats. */
export function dbVacuum() {
  return backendRequest<DbInfo>("/api/db/vacuum", "POST");
}

/** Copy the database (including WAL) to a timestamped sibling file. */
export function dbBackup() {
  return backendRequest<{ path: string; backup_path: string; size_bytes: number }>(
    "/api/db/backup",
    "POST"
  );
}

/** List all non-system tables and views in the database. */
export async function listDbTables() {
  const data = await backendRequest<{ tables: DbTableSummary[] }>("/api/db/tables");
  return data.tables;
}

/** Fetch columns + first N rows of a single table / view. */
export function getDbTableDetail(name: string, limit = 50, offset = 0) {
  const q = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  return backendRequest<DbTableDetail>(
    `/api/db/tables/${encodeURIComponent(name)}?${q.toString()}`
  );
}

/** Create an empty conversation (allocates workspace_dir). */
export function createConversation(title = "") {
  return backendRequest<ConversationRecord>("/api/conversations/", "POST", {
    title,
  });
}

/** 覆盖会话级技能集：Composer 勾选 / 移除 chip 时即时持久化（当前会话持续生效）。 */
export function updateConversationSkills(conversationId: string, skills: string[]) {
  return backendRequest<{ conversation_id: string; skills: string[] }>(
    `/api/conversations/${conversationId}/skills`,
    "PUT",
    { skills }
  );
}

/** Run one chat turn against the agent pipeline.
 *  ``turnId`` 由前端预先生成：后端按它逐步落追踪，UI 可边等边轮询思考流进度。
 *  ``appendUser=false`` 用于群里 @ 多人时的第 2 个及之后的成员：同一句提问只落一次用户消息。 */
export function sendChat(
  message: string,
  conversationId?: string | null,
  roleId?: string | null,
  skills?: string[] | null,
  turnId?: string | null,
  signal?: AbortSignal | null,
  appendUser: boolean = true
) {
  return backendRequest<{
    reply: string;
    from: string;
    difficulty: string;
    rewritten?: string;
    route: string;
    route_reason?: string;
    tool_plan_reason?: string;
    selected_tools: string[];
    tool_trace: Array<{
      tool_name: string;
      tool_call_id?: string | null;
      arguments?: unknown;
      result_text?: string;
      status?: string;
    }>;
    used_llm: boolean;
    turn_id: string;
    tokens: number;
    duration_ms: number;
    conversation_id: string;
    user_message: ChatMessageRecord;
    assistant_message: ChatMessageRecord;
    workspace?: ConversationWorkspace;
  }>("/api/chat", "POST", {
    message,
    conversation_id: conversationId ?? null,
    role_id: roleId ?? null,
    // 会话级技能：空数组 = 清空会话技能集；null = 不改动（保留既有会话技能）
    skills: skills ?? null,
    // 前端生成的本轮 id：追踪逐步落库，UI 轮询时按它取在途进度
    turn_id: turnId ?? null,
    // 群里 @ 多人时只有第一轮需要落用户消息，后续轮次只落各自的助手回复
    append_user_message: appendUser,
  }, signal ?? undefined);
}

/** 撤回 / 停止生成：删除该会话最近一轮（用户句 + 助手句）。
 *  停止在途请求时应传 userContent + afterMessageId，只删 baseline 之后的本轮。 */
export function deleteLastTurn(
  conversationId: string,
  opts?: { userContent?: string | null; afterMessageId?: number | null }
) {
  const params = new URLSearchParams();
  if (opts?.userContent != null && opts.userContent !== "") {
    params.set("user_content", opts.userContent);
  }
  if (opts?.afterMessageId != null && opts.afterMessageId > 0) {
    params.set("after_message_id", String(opts.afterMessageId));
  }
  const q = params.toString() ? `?${params.toString()}` : "";
  return backendRequest<{ deleted: number }>(
    `/api/conversations/${conversationId}/turns/last${q}`,
    "DELETE"
  );
}

export interface ConversationArtifact {
  name: string;
  path: string;
  size_bytes: number;
  modified_at: string;
}

export interface ConversationToolCall {
  id: number;
  turn_id: string | null;
  tool_name: string;
  tool_call_id: string | null;
  arguments_json: string | null;
  result_text: string;
  status: string;
  created_at: string;
}

export interface ConversationWorkspace {
  conversation_id: string;
  workspace_dir: string;
  paths: {
    root?: string;
    output?: string;
    logs?: string;
    runs?: string;
    session_db?: string;
  };
  artifacts: ConversationArtifact[];
  tool_calls: ConversationToolCall[];
  reasoning: Record<string, { route_reason?: string; tool_plan?: string }>;
  memory_count: number;
}

/** 在系统文件管理器中打开该会话工作区。 */
export function openConversationWorkspace(conversationId: string) {
  return backendRequest<{ ok: boolean; path: string }>(
    `/api/conversations/${conversationId}/open-workspace`,
    "POST"
  );
}

/** 在系统文件管理器中打开产物所在目录（path 为该产物文件 / 目录的绝对路径）。 */
export function openArtifactLocation(conversationId: string, path: string) {
  return backendRequest<{ ok: boolean; path: string }>(
    `/api/conversations/${conversationId}/open-artifact`,
    "POST",
    { path }
  );
}

/** Per-conversation workspace insight (output / logs / runs). */
export function getConversationWorkspace(conversationId: string) {
  return backendRequest<ConversationWorkspace>(
    `/api/conversations/${conversationId}/workspace`
  );
}

/** Conversations, newest activity first. */
export async function listConversations(limit = 50) {
  const data = await backendRequest<{ conversations: ConversationRecord[] }>(
    `/api/conversations?limit=${limit}`
  );
  return data.conversations;
}

/** A single conversation together with its persisted messages. */
export function getConversation(conversationId: string) {
  return backendRequest<{
    conversation: ConversationRecord;
    messages: ChatMessageRecord[];
  }>(`/api/conversations/${conversationId}`);
}

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

/** Delete one conversation (messages cascade). */
export function deleteConversation(conversationId: string) {
  return backendRequest<{ deleted: number; id: string }>(
    `/api/conversations/${conversationId}`,
    "DELETE"
  );
}

/** Wipe every conversation and message. */
export function clearHistory() {
  return backendRequest<{ deleted: number }>("/api/conversations", "DELETE");
}

/* -------------------------------------------------------------------------
 * LLM models (backend/models)
 * ---------------------------------------------------------------------- */

export interface LlmModelRecord {
  id: string;
  name: string;
  provider: string;
  model_id: string;
  base_url: string | null;
  key_mask: string | null;
  has_api_key: boolean;
  temperature: number;
  max_tokens: number;
  presence_penalty: number;
  frequency_penalty: number;
  stream: boolean;
  json_mode: boolean;
  retries: number;
  context_window_k: number;
  enabled: boolean;
  description: string;
  created_at: string;
  updated_at: string;
}

export type CreateLlmModelPayload = {
  name: string;
  provider?: string;
  model_id: string;
  base_url?: string | null;
  api_key?: string | null;
  temperature?: number;
  max_tokens?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  stream?: boolean;
  json_mode?: boolean;
  retries?: number;
  context_window_k?: number;
  enabled?: boolean;
  description?: string;
};

export type UpdateLlmModelPayload = Partial<CreateLlmModelPayload>;

export interface ModelTestResult {
  ok: boolean;
  status_code: number | null;
  latency_ms: number;
  message: string;
  url: string;
}

export async function listModels() {
  const data = await backendRequest<{ models: LlmModelRecord[] }>("/api/models/");
  return data.models;
}

export function getModel(modelId: string) {
  return backendRequest<LlmModelRecord>(`/api/models/${modelId}`);
}

export function createModel(payload: CreateLlmModelPayload) {
  return backendRequest<LlmModelRecord>("/api/models/", "POST", payload);
}

export function updateModel(modelId: string, payload: UpdateLlmModelPayload) {
  return backendRequest<LlmModelRecord>(`/api/models/${modelId}`, "PATCH", payload);
}

export function deleteModel(modelId: string) {
  return backendRequest<{ deleted: number; id: string }>(
    `/api/models/${modelId}`,
    "DELETE"
  );
}

export function testModelConnection(modelId: string) {
  return backendRequest<ModelTestResult>(`/api/models/${modelId}/test`, "POST");
}

/* -------------------------------------------------------------------------
 * Local embeddings (backend/embeddings)
 * ---------------------------------------------------------------------- */

/** 本机向量模型（ONNX 本地推理，供知识库 / 历史消息检索）。 */
export interface EmbeddingStatus {
  model: string;
  dim: number;
  installed: boolean;
  cache_dir: string;
  endpoint: string;
  /** 实际下载源：modelscope（阿里云国内链路）/ huggingface（HF_ENDPOINT 镜像）。 */
  source?: string;
  downloading: boolean;
  /** 下载进度 0-100；未在下载时为 null。 */
  progress: number | null;
  error: string | null;
}

/** 只读查询：本地向量模型的安装 / 下载状态。 */
export function getEmbeddingStatus() {
  return backendRequest<EmbeddingStatus>("/api/embeddings/status");
}

/** 触发本地向量模型下载（幂等：已在下载则直接返回当前状态）。 */
export function prepareEmbedding(force = false) {
  return backendRequest<EmbeddingStatus>("/api/embeddings/prepare", "POST", { force });
}

/* -------------------------------------------------------------------------
 * Built-in MCP catalog (backend/mcps)
 * ---------------------------------------------------------------------- */
export interface McpToolParam {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  default?: string | number | boolean | null;
}

export interface McpToolRecord {
  name: string;
  description: string;
  group: string;
  parameters?: McpToolParam[];
}

export interface ShellRuntimeProbe {
  available: boolean;
  path: string | null;
  source?: string;
  error?: string;
  message?: string;
}

export interface McpCatalog {
  groups: Record<string, string[]>;
  tools: McpToolRecord[];
  tool_count: number;
  runtime?: {
    bash: ShellRuntimeProbe;
    powershell: ShellRuntimeProbe;
    browser?: ShellRuntimeProbe;
  };
}

/** Grouped built-in tool list, aligned with settings MCP server ids. */
export function mcpCatalog() {
  return backendRequest<McpCatalog>("/api/mcps/catalog");
}

export interface BashPending {
  id: string;
  command: string;
  cwd: string;
  created_at: number;
}

export function listBashPending() {
  return backendRequest<{ pending: BashPending[] }>("/api/bash/pending");
}

export function approveBash(id: string) {
  return backendRequest<{ ok: boolean }>("/api/bash/approve", "POST", { id });
}

export function denyBash(id: string) {
  return backendRequest<{ ok: boolean }>("/api/bash/deny", "POST", { id });
}

/* -------------------------------------------------------------------------
 * Skills market (SkillHub browse proxy)
 * ---------------------------------------------------------------------- */

export interface SkillCategory {
  id: string;
  label: string;
}

export interface SkillHubItem {
  slug: string;
  name: string;
  description: string;
  category: string;
  category_label: string;
  sub_categories: string[];
  downloads: number;
  installs: number;
  stars: number;
  version: string;
  icon_url: string | null;
  homepage: string;
  publisher: string;
  source: string;
  verified: boolean;
  updated_at: number | null;
}

export interface SkillHubCatalog {
  source: string;
  source_label: string;
  website: string;
  skills: SkillHubItem[];
  total: number;
  page: number;
  page_size: number;
  categories: SkillCategory[];
}

export type ListSkillsParams = {
  page?: number;
  pageSize?: number;
  keyword?: string;
  category?: string;
  sortBy?: "score" | "downloads" | "updated_at";
};

/** 浏览 SkillHub 公开技能目录。 */
export function listSkills(params: ListSkillsParams = {}) {
  const q = new URLSearchParams();
  if (params.page) q.set("page", String(params.page));
  if (params.pageSize) q.set("pageSize", String(params.pageSize));
  if (params.keyword?.trim()) q.set("keyword", params.keyword.trim());
  if (params.category?.trim()) q.set("category", params.category.trim());
  if (params.sortBy) q.set("sortBy", params.sortBy);
  const qs = q.toString();
  return backendRequest<SkillHubCatalog>(
    qs ? `/api/skills/?${qs}` : "/api/skills/"
  );
}

export interface SkillSecurityReport {
  provider: string;
  status: string;
  status_text: string;
  report_url: string;
}

export interface SkillHubDetail extends SkillHubItem {
  overview_md: string;
  skill_md: string | null;
  version_count: number;
  changelog: string;
  security_reports: SkillSecurityReport[];
  website: string;
  installed?: boolean;
}

export interface InstalledSkill {
  slug: string;
  name: string;
  description: string;
  version: string;
  homepage: string;
  installed_at: string;
  path: string;
}

/** 本机已安装技能。 */
export function listInstalledSkills() {
  return backendRequest<{ skills: InstalledSkill[]; total: number }>(
    "/api/skills/installed"
  );
}

/** 拉取单个技能详情（含可选 SKILL.md）。 */
export function getSkill(slug: string) {
  return backendRequest<SkillHubDetail>(
    `/api/skills/${encodeURIComponent(slug)}`
  );
}

/** 安装技能到本机。 */
export function installSkill(slug: string) {
  return backendRequest<SkillHubDetail & { local?: InstalledSkill }>(
    `/api/skills/${encodeURIComponent(slug)}/install`,
    "POST"
  );
}

/** 卸载本机技能。 */
export function uninstallSkill(slug: string) {
  return backendRequest<{ slug: string; removed: boolean }>(
    `/api/skills/${encodeURIComponent(slug)}`,
    "DELETE"
  );
}

/* -------------------------------------------------------------------------
 * Roles（用户可配置角色：人格 / 模型 / 工具 / 生成参数）
 * 后端 roles 模块（SQLite），与 models 同样走直接 fetch。
 * ---------------------------------------------------------------------- */

export type RoleTone = "brand" | "violet" | "teal" | "amber" | "peach";

export interface RoleRecord {
  id: string;
  name: string;
  /** 列表头像上的单字。 */
  initial: string;
  /** 头像图标文件名（如 avatar-11.png / avatar-user.png），空串用 initial 色块。 */
  avatar: string;
  /** 系统提示词（人格与行为边界）。 */
  prompt: string;
  /** 绑定模型 id；空串表示尚未配置模型。 */
  model_id: string;
  tone: RoleTone;
  temperature: number;
  max_tokens: number;
  presence_penalty: number;
  frequency_penalty: number;
  stream: boolean;
  json_mode: boolean;
  retries: number;
  /** 带入上下文的最近对话轮数。 */
  memory: number;
  enabled: boolean;
  /** 已勾选的 MCP 工具 id。 */
  tools: string[];
  /** 挂载的知识库名称。 */
  kb: string[];
  /** 常驻技能 slug 列表；每次聊天自动注入 role prompt（可与消息级临时技能叠加）。 */
  resident_skills: string[];
  /** 在用会话数（后端统计，本地只读）。 */
  sessions: number;
  /** 内置主角色，可改人格与工具，不可删除。 */
  primary: boolean;
  created_at: string;
  updated_at: string;
}

export type CreateRolePayload = {
  name: string;
  initial?: string;
  /** 头像图标文件名；空串 / 缺省用 initial 色块。 */
  avatar?: string;
  prompt?: string;
  model_id?: string;
  tone?: RoleTone;
  temperature?: number;
  max_tokens?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  stream?: boolean;
  json_mode?: boolean;
  retries?: number;
  memory?: number;
  enabled?: boolean;
  tools?: string[];
  kb?: string[];
  /** 常驻技能 slug 列表（可选）；聊天时自动注入角色提示词。 */
  resident_skills?: string[];
  primary?: boolean;
};

export type UpdateRolePayload = Partial<CreateRolePayload>;

export async function listRoles() {
  const data = await backendRequest<{ roles: RoleRecord[] }>("/api/roles/");
  return data.roles;
}

export function getRole(roleId: string) {
  return backendRequest<RoleRecord>(`/api/roles/${roleId}`);
}

export function createRole(payload: CreateRolePayload) {
  return backendRequest<RoleRecord>("/api/roles/", "POST", payload);
}

export function updateRole(roleId: string, payload: UpdateRolePayload) {
  return backendRequest<RoleRecord>(`/api/roles/${roleId}`, "PATCH", payload);
}

export function deleteRole(roleId: string) {
  return backendRequest<{ deleted: number; id: string }>(
    `/api/roles/${roleId}`,
    "DELETE"
  );
}
