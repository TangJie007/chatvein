import { backendRequest } from "./client";

/** 一条声明式权限规则；字段含义见 backend/mcps/permissions.py::PermissionRule。 */
export type PermissionEffect = "allow" | "ask" | "deny";
export type PermissionMode = "normal" | "strict";

export interface PermissionRule {
  id?: string;
  effect: PermissionEffect;
  tool?: string;
  path_prefix?: string;
  path_not_prefix?: string;
  url_host_in?: string[];
  read_only?: boolean;
  note?: string;
}

export interface PermissionQuota {
  max_per_tool_per_conversation?: number;
  max_per_turn_tool_calls?: number;
}

export interface PermissionView {
  mode: PermissionMode;
  env_mode: boolean;
  rules: PermissionRule[];
  quota: PermissionQuota;
  path: string;
  exists: boolean;
  /** 配置文件解析失败的原因（空字符串表示正常）。 */
  error: string;
}

export interface PermissionPayload {
  mode: PermissionMode;
  rules: PermissionRule[];
  quota: PermissionQuota;
}

export function getPermissions(): Promise<PermissionView> {
  return backendRequest<PermissionView>("/api/permissions");
}

export function savePermissions(payload: PermissionPayload): Promise<PermissionView> {
  return backendRequest<PermissionView>("/api/permissions", "PUT", payload);
}
