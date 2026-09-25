import { backendRequest } from "./client";

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
