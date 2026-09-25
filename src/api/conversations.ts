import { backendRequest } from "./client";

export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessageRecord {
  id: number;
  conversation_id: string;
  role: ChatRole;
  content: string;
  used_llm: boolean;
  route: string | null;
  created_at: string;
  turn_id?: string | null;
  tokens?: number | null;
  duration_ms?: number | null;
  /** 执行者角色 id：群组 @ 指派时标识由哪个成员回复 */
  actor_id?: string | null;
}

export interface ConversationRecord {
  id: string;
  title: string;
  workspace_dir: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  last_message: string | null;
  /** 会话级技能 slug 列表：Composer 勾选，当前会话内持续生效。 */
  skills?: string[];
}

export interface ConversationArtifact {
  name: string;
  path: string;
  size_bytes: number;
  modified_at: string;
}

export interface ConversationToolCall {
  id: number;
  turn_id: string | null;
  tool_name: string;
  tool_call_id: string | null;
  arguments_json: string | null;
  result_text: string;
  status: string;
  created_at: string;
}

export interface ConversationWorkspace {
  conversation_id: string;
  workspace_dir: string;
  paths: {
    root?: string;
    output?: string;
    logs?: string;
    runs?: string;
    session_db?: string;
  };
  artifacts: ConversationArtifact[];
  tool_calls: ConversationToolCall[];
  reasoning: Record<string, { route_reason?: string; tool_plan?: string }>;
  memory_count: number;
}

/** Create an empty conversation (allocates workspace_dir). */
export function createConversation(title = "") {
  return backendRequest<ConversationRecord>("/api/conversations/", "POST", {
    title,
  });
}

/** 补注册群组成员：把参与角色 id 合并进会话（与现有成员去重，chats 模块）。 */
export function registerGroupMembers(conversationId: string, groupMembers: string[]) {
  return backendRequest<{ conversation_id: string; group_members: string[] }>(
    `/api/chats/${conversationId}/group-members`,
    "POST",
    { group_members: groupMembers }
  );
}

/** 读取会话群组成员（角色 id 列表，chats 模块）。 */
export function getGroupMembers(conversationId: string) {
  return backendRequest<{ conversation_id: string; group_members: string[] }>(
    `/api/chats/${conversationId}/group-members`
  );
}

/** 覆盖会话级技能集：Composer 勾选 / 移除 chip 时即时持久化（当前会话持续生效）。 */
export function updateConversationSkills(conversationId: string, skills: string[]) {
  return backendRequest<{ conversation_id: string; skills: string[] }>(
    `/api/conversations/${conversationId}/skills`,
    "PUT",
    { skills }
  );
}

/** Run one chat turn against the agent pipeline.
 *  ``turnId`` 由前端预先生成：后端按它逐步落追踪，UI 可边等边轮询思考流进度。
 *  ``appendUser=false`` 用于群里 @ 多人时的第 2 个及之后的成员：同一句提问只落一次用户消息。 */
export function sendChat(
  message: string,
  conversationId?: string | null,
  roleId?: string | null,
  skills?: string[] | null,
  turnId?: string | null,
  signal?: AbortSignal | null,
  appendUser: boolean = true,
  groupMembers?: string[] | null
) {
  return backendRequest<{
    reply: string;
    from: string;
    difficulty: string;
    rewritten?: string;
    route: string;
    route_reason?: string;
    tool_plan_reason?: string;
    selected_tools: string[];
    tool_trace: Array<{
      tool_name: string;
      tool_call_id?: string | null;
      arguments?: unknown;
      result_text?: string;
      status?: string;
    }>;
    used_llm: boolean;
    turn_id: string;
    tokens: number;
    duration_ms: number;
    conversation_id: string;
    user_message: ChatMessageRecord;
    assistant_message: ChatMessageRecord;
    workspace?: ConversationWorkspace;
  }>("/api/chat", "POST", {
    message,
    conversation_id: conversationId ?? null,
    role_id: roleId ?? null,
    // 会话级技能：空数组 = 清空会话技能集；null = 不改动（保留既有会话技能）
    skills: skills ?? null,
    // 前端生成的本轮 id：追踪逐步落库，UI 轮询时按它取在途进度
    turn_id: turnId ?? null,
    // 群里 @ 多人时只有第一轮需要落用户消息，后续轮次只落各自的助手回复
    append_user_message: appendUser,
    // 群组成员：随消息透传，后端注册 / 补注册到 chats 群组表（合并去重）
    group_members: groupMembers ?? null,
  }, signal ?? undefined);
}

/** 撤回 / 停止生成：删除该会话最近一轮（用户句 + 助手句）。
 *  停止在途请求时应传 userContent + afterMessageId，只删 baseline 之后的本轮。 */
export function deleteLastTurn(
  conversationId: string,
  opts?: { userContent?: string | null; afterMessageId?: number | null }
) {
  const params = new URLSearchParams();
  if (opts?.userContent != null && opts.userContent !== "") {
    params.set("user_content", opts.userContent);
  }
  if (opts?.afterMessageId != null && opts.afterMessageId > 0) {
    params.set("after_message_id", String(opts.afterMessageId));
  }
  const q = params.toString() ? `?${params.toString()}` : "";
  return backendRequest<{ deleted: number }>(
    `/api/conversations/${conversationId}/turns/last${q}`,
    "DELETE"
  );
}

/** 在系统文件管理器中打开该会话工作区。 */
export function openConversationWorkspace(conversationId: string) {
  return backendRequest<{ ok: boolean; path: string }>(
    `/api/conversations/${conversationId}/open-workspace`,
    "POST"
  );
}

/** 在系统文件管理器中打开产物所在目录（path 为该产物文件 / 目录的绝对路径）。 */
export function openArtifactLocation(conversationId: string, path: string) {
  return backendRequest<{ ok: boolean; path: string }>(
    `/api/conversations/${conversationId}/open-artifact`,
    "POST",
    { path }
  );
}

/** Per-conversation workspace insight (output / logs / runs). */
export function getConversationWorkspace(conversationId: string) {
  return backendRequest<ConversationWorkspace>(
    `/api/conversations/${conversationId}/workspace`
  );
}

/** Conversations, newest activity first. */
export async function listConversations(limit = 50) {
  const data = await backendRequest<{ conversations: ConversationRecord[] }>(
    `/api/conversations?limit=${limit}`
  );
  return data.conversations;
}

/** A single conversation together with its persisted messages. */
export function getConversation(conversationId: string) {
  return backendRequest<{
    conversation: ConversationRecord;
    messages: ChatMessageRecord[];
  }>(`/api/conversations/${conversationId}`);
}

/** Delete one conversation (messages cascade). */
export function deleteConversation(conversationId: string) {
  return backendRequest<{ deleted: number; id: string }>(
    `/api/conversations/${conversationId}`,
    "DELETE"
  );
}

/** Wipe every conversation and message. */
export function clearHistory() {
  return backendRequest<{ deleted: number }>("/api/conversations", "DELETE");
}
