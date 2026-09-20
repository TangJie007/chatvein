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
