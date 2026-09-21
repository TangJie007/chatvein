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

/** Rust pushes the real backend URL at startup; this caches it. */
export async function getBackendUrl(): Promise<string> {
  if (cachedUrl) return cachedUrl;
  cachedUrl = await invoke<string>("backend_url");
  return cachedUrl;
}

/** Wait until the Python backend is actually listening (polls /api/health). */
export async function waitForBackend(timeoutMs = 20000): Promise<string> {
  const url = await getBackendUrl();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${url}/api/health`);
      if (r.ok) return url;
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
  body?: unknown
): Promise<T> {
  const url = await waitForBackend();
  const res = await fetch(`${url}${endpoint}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* keep raw text when not JSON */
  }
  if (!res.ok) {
    throw new Error(`Backend ${res.status}: ${text}`);
  }
  return data as T;
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
}

export interface ConversationRecord {
  id: string;
  title: string;
  workspace_dir: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  last_message: string | null;
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

/** Create an empty conversation (allocates workspace_dir). */
export function createConversation(title = "") {
  return backendRequest<ConversationRecord>("/api/conversations/", "POST", {
    title,
  });
}

/** Run one chat turn against the agent pipeline. */
export function sendChat(message: string, conversationId?: string | null) {
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
    conversation_id: string;
    user_message: ChatMessageRecord;
    assistant_message: ChatMessageRecord;
    workspace?: ConversationWorkspace;
  }>("/api/chat", "POST", {
    message,
    conversation_id: conversationId ?? null,
  });
}

export interface ConversationArtifact {
  name: string;
  path: string;
  size_bytes: number;
  modified_at: string;
}

export interface ConversationToolCall {
  id: number;
  turn_id: number | null;
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
  memory_count: number;
}

/** 在系统文件管理器中打开该会话工作区。 */
export function openConversationWorkspace(conversationId: string) {
  return backendRequest<{ ok: boolean; path: string }>(
    `/api/conversations/${conversationId}/open-workspace`,
    "POST"
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
  is_default: boolean;
  is_primary: boolean;
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
  is_default?: boolean;
  is_primary?: boolean;
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

export function setDefaultModel(modelId: string) {
  return backendRequest<LlmModelRecord>(`/api/models/${modelId}/default`, "POST");
}

export function testModelConnection(modelId: string) {
  return backendRequest<ModelTestResult>(`/api/models/${modelId}/test`, "POST");
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

/** Resolve display model: primary → default → first enabled → first. */
export function pickActiveModel(models: LlmModelRecord[]): LlmModelRecord | null {
  if (models.length === 0) return null;
  return (
    models.find((m) => m.is_primary && m.enabled) ??
    models.find((m) => m.is_default && m.enabled) ??
    models.find((m) => m.enabled) ??
    models[0] ??
    null
  );
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

/** 浏览 SkillHub 公开技能目录（安装后续再接）。 */
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
}

/** 拉取单个技能详情（含可选 SKILL.md）。 */
export function getSkill(slug: string) {
  return backendRequest<SkillHubDetail>(
    `/api/skills/${encodeURIComponent(slug)}`
  );
}
