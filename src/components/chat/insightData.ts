import dayjs from "dayjs";
import type { ConversationWorkspace } from "../../api";
import type { InsightArtifact, InsightThreadItem } from "./InsightPanel";

/** 洞察面板的数据派生：对话视图与群组视图共用，避免两份口径漂移。 */

function artifactType(name: string): InsightArtifact["type"] {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "image";
  if (["csv", "tsv", "xlsx", "xls"].includes(ext)) return "table";
  return "file";
}

function artifactMeta(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1).replace(/\.0$/, "")} KB`;
  return `${(size / 1024 / 1024).toFixed(1).replace(/\.0$/, "")} MB`;
}

/** 选中轮次的思考流：路由理由 + 工具计划 + 该轮工具调用。 */
export function buildInsightThread(
  workspace: ConversationWorkspace | null,
  turnId: string | null | undefined
): InsightThreadItem[] {
  const reasoning = turnId ? workspace?.reasoning?.[turnId] : undefined;
  const steps: Extract<InsightThreadItem, { role: "trace" }>["trace"]["steps"] = [];
  if (reasoning?.route_reason) {
    steps.push({ kind: "thought", text: reasoning.route_reason });
  }
  if (reasoning?.tool_plan) {
    steps.push({ kind: "thought", text: reasoning.tool_plan });
  }
  for (const call of (workspace?.tool_calls ?? []).filter((tc) => tc.turn_id === turnId)) {
    const blocked = call.status === "blocked" || call.status === "denied";
    steps.push({
      kind: "tool",
      tool: call.tool_name,
      args: call.arguments_json?.trim() || "{}",
      status: blocked ? "blocked" : "ok",
      result: call.result_text.trim() || (blocked ? "已拦截" : "已返回"),
    });
  }
  if (steps.length === 0) return [];
  const goal =
    reasoning?.route_reason ||
    steps.find((s) => s.kind === "thought")?.text ||
    "完成本轮请求";
  return [{ role: "trace", trace: { goal, steps } }];
}

export function buildInsightArtifacts(
  workspace: ConversationWorkspace | null
): InsightArtifact[] {
  return (workspace?.artifacts ?? []).map((item) => ({
    type: artifactType(item.name),
    name: item.name,
    meta: artifactMeta(item.size_bytes),
    time: item.modified_at ? dayjs(item.modified_at).format("HH:mm") : "",
    path: item.path || undefined,
  }));
}
