import type { LlmModelRecord } from "../../../api";

export function modelLabel(modelId: string, models: LlmModelRecord[]): string {
  if (!modelId) return "暂未配置模型";
  return models.find((m) => m.id === modelId)?.name ?? "暂未配置模型";
}
