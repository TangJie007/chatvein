import { backendRequest } from "./client";

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
