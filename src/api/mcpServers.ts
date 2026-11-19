/** 外部 MCP server 配置接口。
 *
 * 凭据只上行（`env` / `headers` 明文进后端，密文落库），下行永远只有键名；
 * 想修改凭据就整体重传，没传的键保持原值（见后端 service.update_server）。
 */
import { backendRequest } from "./client";

export type McpTransport = "stdio" | "sse" | "http";
export type McpApprovalMode = "ask" | "auto";

export type McpServerState = "connected" | "connecting" | "error" | "idle" | "closed" | "missing";

export type McpServerStatus = {
  state: McpServerState;
  error: string | null;
  tool_count: number;
  transport?: McpTransport;
};

export type McpExternalTool = {
  name: string;
  tool: string;
  description: string;
  enabled: boolean;
  params: string[];
};

export type McpExternalServer = {
  id: string;
  name: string;
  transport: McpTransport;
  command: string;
  url: string;
  env_keys: string[];
  header_keys: string[];
  allow_tools: string[];
  approval_mode: McpApprovalMode;
  enabled: boolean;
  timeout_s: number;
  group: string;
  status: McpServerStatus;
  tools: McpExternalTool[];
};

export type McpServerPayload = {
  name?: string;
  transport?: McpTransport;
  command?: string;
  url?: string;
  /** 传了就整体替换；不传 = 保留旧凭据；传 {} = 清空。 */
  env?: Record<string, string>;
  headers?: Record<string, string>;
  allow_tools?: string[];
  approval_mode?: McpApprovalMode;
  enabled?: boolean;
  timeout_s?: number;
};

export type McpServerList = {
  servers: McpExternalServer[];
  available: { enabled: boolean; sdk: boolean };
};

export function listMcpServers(): Promise<McpServerList> {
  return backendRequest<McpServerList>("/api/mcp-servers/");
}

export function createMcpServer(payload: McpServerPayload): Promise<McpExternalServer> {
  return backendRequest<McpExternalServer>("/api/mcp-servers/", "POST", payload);
}

export function updateMcpServer(
  serverId: string,
  payload: McpServerPayload
): Promise<McpExternalServer> {
  return backendRequest<McpExternalServer>(`/api/mcp-servers/${serverId}`, "PATCH", payload);
}

export function deleteMcpServer(serverId: string): Promise<{ deleted: string }> {
  return backendRequest<{ deleted: string }>(`/api/mcp-servers/${serverId}`, "DELETE");
}

export function reconnectMcpServer(serverId: string): Promise<McpExternalServer> {
  return backendRequest<McpExternalServer>(`/api/mcp-servers/${serverId}/reconnect`, "POST");
}
