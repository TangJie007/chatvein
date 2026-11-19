import { backendRequest } from "./client";

/** 一条审计事件；字段与 audit_events 表一一对应（见 backend/mcps/audit.py）。 */
export interface AuditEvent {
  seq: number;
  ts: string;
  actor: string;
  scope: string;
  action: string;
  tool: string;
  args: Record<string, unknown>;
  result_code: string;
  duration_ms: number;
  decision: string;
  decision_by: string;
}

export interface AuditEventsResponse {
  enabled: boolean;
  path: string;
  events: AuditEvent[];
  count: number;
}

export interface AuditQuery {
  tool?: string;
  action?: string;
  decision?: string;
  since?: string;
  limit?: number;
}

function toQuery(query: AuditQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

export function listAuditEvents(query: AuditQuery = {}): Promise<AuditEventsResponse> {
  return backendRequest<AuditEventsResponse>(`/api/audit/events${toQuery(query)}`);
}

export function getAuditStatus(): Promise<{ enabled: boolean; path: string }> {
  return backendRequest<{ enabled: boolean; path: string }>("/api/audit/status");
}
