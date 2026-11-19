import { backendRequest, backendStream, type SSEEvent } from "./client";

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
  /** 绑定的角色 id（空表示走后端默认主角色）：新建时选定，之后该会话整体沿用。 */
  role_id?: string | null;
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

/** Create an empty conversation (allocates workspace_dir).
 *  ``roleId`` 非空时把会话绑定到该角色：之后该会话整体沿用（发送未显式带 role_id 时回退）。 */
export function createConversation(title = "", roleId: string | null = null) {
  return backendRequest<ConversationRecord>("/api/conversations/", "POST", {
    title,
    role_id: roleId ?? null,
  });
}

/** 切换会话绑定的角色：持久化到会话，后续每轮对话都交给该角色。 */
export function updateConversationRole(conversationId: string, roleId: string | null) {
  return backendRequest<{ conversation_id: string; role_id: string | null }>(
    `/api/conversations/${conversationId}/role`,
    "PUT",
    { role_id: roleId ?? null }
  );
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

/** 一轮生成的客户端超时上限：工具链 / 图片处理 / 命令审批都可能耗时数分钟，
 *  用默认 30s 会把正常长任务误判成「已取消」，这里放宽到 20 分钟。 */
const CHAT_TIMEOUT_MS = 20 * 60 * 1000;

/** 一轮生成的完整响应：流式 `done` 事件与非流式接口完全一致。 */
export interface ChatResponse {
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
}

/** 流式事件：token 增量 / tool 进度 / trace 阶段 / done / cancelled / error。 */
export type ChatStreamEvent = SSEEvent;

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
  return backendRequest<ChatResponse>("/api/chat", "POST", chatBody(message, conversationId, roleId, skills, turnId, appendUser, groupMembers), {
    signal: signal ?? undefined,
    // 一轮生成可能跑很久（工具链、图片处理、命令审批等待），不能用默认 30s；
    // 用户随时可点停止，这里只留一个很长的兜底上限。
    timeoutMs: CHAT_TIMEOUT_MS,
  });
}

function chatBody(
  message: string,
  conversationId?: string | null,
  roleId?: string | null,
  skills?: string[] | null,
  turnId?: string | null,
  appendUser: boolean = true,
  groupMembers?: string[] | null
) {
  return {
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
  };
}

/** SSE 版本：``onEvent`` 拿到 token/tool/trace 增量，``done``/``cancelled`` 收尾后 resolve。
 *  参数与 ``sendChat`` 完全对齐，便于不支持流式的环境一键回落。 */
export function sendChatStream(
  message: string,
  conversationId?: string | null,
  roleId?: string | null,
  skills?: string[] | null,
  turnId?: string | null,
  signal?: AbortSignal | null,
  appendUser: boolean = true,
  groupMembers?: string[] | null,
  onEvent?: (event: ChatStreamEvent) => void
) {
  return backendStream(
    "/api/chat/stream",
    chatBody(message, conversationId, roleId, skills, turnId, appendUser, groupMembers),
    {
      signal,
      onEvent: onEvent ?? (() => undefined),
    }
  );
}

/** 真·取消：通知后端停掉这一轮（只 abort HTTP 不会让后端停手）。
 *  后端在下一个模型 / 工具检查点抛 TurnCancelled，本轮追踪收尾为 cancelled。
 *  轮次已结束 / id 未知时无害（标记 30 分钟后过期）。 */
export function cancelChat(turnId: string) {
  return backendRequest<{ turn_id: string; accepted: boolean }>(
    "/api/chat/cancel",
    "POST",
    { turn_id: turnId },
    // 取消要快：短暂超时即可，失败也不该弹红字（前端已本地停止）。
    { timeoutMs: 5000 }
  );
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
