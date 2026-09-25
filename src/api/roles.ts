import { backendRequest } from "./client";

export type RoleTone = "brand" | "violet" | "teal" | "amber" | "peach";

export interface RoleRecord {
  id: string;
  name: string;
  /** 一句话描述（列表副标题 / 群组花名册）。 */
  description: string;
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
  /** 一句话描述（可选）。 */
  description?: string;
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
