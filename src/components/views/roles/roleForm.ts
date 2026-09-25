import type { LlmModelRecord, RoleRecord } from "../../../api";

export type RoleForm = Omit<RoleRecord, "id" | "sessions" | "primary"> & {
  id: string;
  sessions: number;
  primary: boolean;
};

export function toForm(role: RoleRecord): RoleForm {
  return { ...role };
}

export function modelLabel(modelId: string, models: LlmModelRecord[]): string {
  if (!modelId) return "暂未配置模型";
  return models.find((m) => m.id === modelId)?.name ?? "暂未配置模型";
}
