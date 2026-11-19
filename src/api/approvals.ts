import { backendRequest } from "./client";

/** 一个待人工确认的动作：命令 / 会话外路径 / 工具调用（后续扩展）。 */
export interface ApprovalItem {
  id: string;
  turn_id: string;
  kind: string;
  title: string;
  detail: string;
  risk: string;
  tool_call_id: string;
  created_at: number;
  /** 兼容旧命令弹窗字段。 */
  command?: string;
  cwd?: string;
}

export function listApprovals() {
  return backendRequest<{ pending: ApprovalItem[] }>("/api/approvals/pending");
}

export function decideApproval(requestId: string, allow: boolean) {
  return backendRequest<{ request_id: string; decision: string }>(
    `/api/approvals/${encodeURIComponent(requestId)}/decision`,
    "POST",
    { allow }
  );
}
