import { backendRequest } from "./client";

export type MemoryKind = "fact" | "preference" | "identity" | "project" | "other";
export type MemoryScope = "global" | "role" | "conversation";
export type MemoryStatus = "pending" | "active";

export interface MemoryRecord {
  id: string;
  scope: MemoryScope;
  scope_id: string;
  kind: MemoryKind;
  content: string;
  confidence: number;
  status: MemoryStatus;
  source_turn_id: string;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
}

export interface MemoryStatusSummary {
  total: number;
  active: number;
  pending: number;
  expired: number;
  /** 抽取与召回总开关（`CHATVEIN_MEMORY=0` 时 false）。 */
  enabled: boolean;
  /** 抽取结果是否直接生效；false 时要用户确认。 */
  auto_accept: boolean;
  /** 每 N 轮抽一次。 */
  every_turns: number;
}

export interface MemoryPayload {
  content: string;
  kind?: MemoryKind;
  scope?: MemoryScope;
  scope_id?: string | null;
  status?: MemoryStatus;
  confidence?: number;
}

/** 长期记忆列表；不传 status 则全部（含待确认）。 */
export function listMemories(params: { status?: MemoryStatus; scope?: MemoryScope; limit?: number } = {}) {
  const q = new URLSearchParams();
  if (params.status) q.set("status", params.status);
  if (params.scope) q.set("scope", params.scope);
  if (params.limit) q.set("limit", String(params.limit));
  const qs = q.toString();
  return backendRequest<{ memories: MemoryRecord[] }>(
    qs ? `/api/memories/?${qs}` : "/api/memories/"
  );
}

export function getMemoryStatus() {
  return backendRequest<MemoryStatusSummary>("/api/memories/status");
}

export function createMemory(payload: MemoryPayload) {
  return backendRequest<MemoryRecord>("/api/memories/", "POST", payload);
}

export function updateMemory(
  id: string,
  payload: Partial<Pick<MemoryPayload, "content" | "kind" | "status" | "confidence">>
) {
  return backendRequest<MemoryRecord>(`/api/memories/${encodeURIComponent(id)}`, "PATCH", payload);
}

export function deleteMemory(id: string) {
  return backendRequest<{ ok: boolean }>(`/api/memories/${encodeURIComponent(id)}`, "DELETE");
}

/** 清过期 + 合并重复；返回各自动作了多少条。 */
export function consolidateMemories() {
  return backendRequest<{ purged: number; merged: number }>("/api/memories/consolidate", "POST");
}
