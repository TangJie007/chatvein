import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import "dayjs/locale/zh-cn";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  createConversation,
  deleteConversation,
  deleteLastTurn,
  getConversation,
  getConversationWorkspace,
  listConversations,
  listModels,
  listRoles,
  openConversationWorkspace,
  pickActiveModel,
  sendChat,
  type ConversationRecord,
  type ConversationWorkspace,
  type ChatMessageRecord,
  type LlmModelRecord,
  type RoleRecord,
} from "../../api";
import { ChatPanel, type ChatMessage } from "../chat/ChatPanel";
import type { InsightArtifact, InsightThreadItem } from "../chat/InsightPanel";
import { SessionList, type SessionItem } from "../chat/SessionList";
import { openTraceWindow } from "../../lib/openTrace";
import { VIEW_PATH } from "../../types/view";

dayjs.extend(relativeTime);
dayjs.locale("zh-cn");

/** Survives ChatView remount so sticky newRequestId from App doesn't re-create. */
let lastHandledNewRequestId = 0;

const AVATAR_COLORS = [
  "bg-brand-600",
  "bg-violet-400",
  "bg-sky-500",
  "bg-emerald-500",
  "bg-amber-500",
];

function toSessionItem(c: ConversationRecord): SessionItem {
  const title = c.title.trim() || "新会话";
  const idx =
    Math.abs(
      [...c.id].reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
    ) % AVATAR_COLORS.length;
  return {
    id: c.id,
    title,
    preview: c.last_message?.trim() || c.workspace_dir || "尚无消息",
    time: c.updated_at ? dayjs(c.updated_at).fromNow() : "",
    avatar: title.slice(0, 1).toUpperCase(),
    colorClass: AVATAR_COLORS[idx] ?? "bg-brand-600",
    tagLabel: c.message_count > 0 ? "进行中" : "空闲",
    tagTone: c.message_count > 0 ? "brand" : "ok",
  };
}

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

function estimateTokens(text: string): number {
  let tokens = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    tokens += code > 0xff ? 1 : 0.25;
  }
  return Math.ceil(tokens);
}

function formatTokenCount(tokens: number): string {
  if (tokens < 1000) return String(tokens);
  const k = tokens / 1000;
  return `${k >= 10 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, "")}K`;
}

function toChatMessages(rows: ChatMessageRecord[]): ChatMessage[] {
  return rows.map((m) => ({
    id: String(m.id),
    role: m.role === "assistant" ? "agent" : m.role === "system" ? "system" : "user",
    content: m.content,
    turnId: m.turn_id ?? null,
    tokens: m.tokens ?? null,
    durationMs: m.duration_ms ?? null,
  }));
}

/** Tauri 插件 abort 文案可能是 canceled / cancelled；浏览器则为 AbortError。 */
function isAbortError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === "AbortError") return true;
  const msg = err.message.toLowerCase();
  return (
    msg === "request cancelled" ||
    msg === "request canceled" ||
    msg.includes("request cancelled") ||
    msg.includes("request canceled")
  );
}

type ChatViewProps = {
  modelName?: string;
  newRequestId?: number;
  onConversationCount?: (n: number) => void;
};

export function ChatView({
  modelName,
  newRequestId = 0,
  onConversationCount,
}: ChatViewProps) {
  const navigate = useNavigate();
  const { conversationId: routeConversationId } = useParams<{
    conversationId?: string;
  }>();
  const activeId = routeConversationId ?? null;
  const routeIdRef = useRef(routeConversationId);
  routeIdRef.current = routeConversationId;
  const selectConversation = useCallback(
    (id: string | null, replace = false) => {
      navigate(id ? `${VIEW_PATH.chat}/${id}` : VIEW_PATH.chat, { replace });
    },
    [navigate]
  );
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [query, setQuery] = useState("");
  const [insightOpen, setInsightOpen] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [workspace, setWorkspace] = useState<ConversationWorkspace | null>(null);
  const [selectedTurnId, setSelectedTurnId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setErrorState] = useState<string | null>(null);
  const [errorTone, setErrorTone] = useState<"danger" | "muted">("danger");
  const setError = useCallback((message: string | null, tone: "danger" | "muted" = "danger") => {
    setErrorTone(tone);
    setErrorState(message);
  }, []);
  /** 当前在途请求的取消控制器；非 null 表示 Agent 正在生成。 */
  const abortRef = useRef<AbortController | null>(null);
  /** 本轮乐观插入的用户 / 助手气泡 id 与原文，便于停止 / 撤回时精确移除。 */
  const pendingRef = useRef<{
    userId: string;
    agentId: string;
    text: string;
  } | null>(null);
  /** 编辑时回灌到输入框的原文（null 表示无需回灌）。 */
  const [restoreText, setRestoreText] = useState<string | null>(null);
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [models, setModels] = useState<LlmModelRecord[]>([]);
  const [roleId, setRoleId] = useState<string | null>(null);
  const [metaById, setMetaById] = useState<
    Record<
      string,
      {
        difficulty?: string;
        selectedTools?: string[];
        routeReason?: string;
        toolPlan?: string;
      }
    >
  >({});

  const refreshList = useCallback(async () => {
    const rows = await listConversations(80);
    setSessions(rows.map(toSessionItem));
    onConversationCount?.(rows.length);
    return rows;
  }, [onConversationCount]);

  const refreshListRef = useRef(refreshList);
  refreshListRef.current = refreshList;

  const loadConversation = useCallback(async (id: string) => {
    const data = await getConversation(id);
    const msgs = toChatMessages(data.messages);
    setMessages(msgs);
    const lastAgent = [...msgs].reverse().find((m) => m.role === "agent" && m.turnId);
    setSelectedTurnId(lastAgent?.turnId ?? null);
    try {
      setWorkspace(await getConversationWorkspace(id));
    } catch {
      setWorkspace(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([listRoles(), listModels()])
      .then(([roleRows, modelRows]) => {
        if (cancelled) return;
        setRoles(roleRows);
        setModels(modelRows);
        setRoleId((prev) => {
          if (prev && roleRows.some((role) => role.id === prev)) return prev;
          return roleRows.find((role) => role.primary)?.id ?? roleRows[0]?.id ?? null;
        });
      })
      .catch(() => {
        /* backend may still be starting */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await refreshList();
        if (cancelled) return;
        if (!routeIdRef.current && rows.length > 0) {
          selectConversation(rows[0]!.id, true);
        }
      } catch {
        /* backend may still be starting */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshList, selectConversation]);

  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      setWorkspace(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        await loadConversation(activeId);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeId, loadConversation]);

  useEffect(() => {
    // App keeps newRequestId sticky; remounting ChatView (leave/return 对话)
    // must not treat the same id as another create request.
    if (!newRequestId || newRequestId === lastHandledNewRequestId) return;
    let cancelled = false;
    // StrictMode 会立刻清理再执行一次；推迟到清理之后再请求，避免点一次建两个。
    const timer = window.setTimeout(() => {
      void (async () => {
        if (cancelled || newRequestId === lastHandledNewRequestId) return;
        lastHandledNewRequestId = newRequestId;
        try {
          const created = await createConversation("");
          if (cancelled) return;
          await refreshListRef.current();
          if (cancelled) return;
          selectConversation(created.id);
          setMessages([]);
          setMetaById((prev) => ({ ...prev, [created.id]: {} }));
          setError(null);
        } catch (err) {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : String(err));
          }
        }
      })();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [newRequestId, selectConversation]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter(
      (s) =>
        s.title.toLowerCase().includes(q) || s.preview.toLowerCase().includes(q)
    );
  }, [query, sessions]);

  const session = sessions.find((s) => s.id === activeId) ?? null;
  const lastMeta = (activeId && metaById[activeId]) || {};
  const activeRole = roles.find((role) => role.id === roleId) ?? roles.find((role) => role.primary) ?? null;
  const boundModel = activeRole?.model_id
    ? models.find((model) => model.id === activeRole.model_id) ?? null
    : null;
  const displayModel = boundModel ?? pickActiveModel(models);
  const resolvedModelName = displayModel?.name ?? modelName ?? "主对话模型";
  const contextTotal = Math.max(1, (displayModel?.context_window_k ?? 128) * 1000);
  const contextUsed = messages.reduce((sum, message) => sum + estimateTokens(message.content), 0);
  const contextPct = Math.min(100, Math.round((contextUsed / contextTotal) * 100));
  const contextTitle = `上下文已用 ${contextPct}% · ${formatTokenCount(contextUsed)} / ${formatTokenCount(contextTotal)} tokens`;

  const insightThread = useMemo<InsightThreadItem[]>(() => {
    const turnId = selectedTurnId;
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
  }, [selectedTurnId, workspace]);

  const artifacts = useMemo<InsightArtifact[]>(() => {
    return (workspace?.artifacts ?? []).map((item) => ({
      type: artifactType(item.name),
      name: item.name,
      meta: artifactMeta(item.size_bytes),
      time: item.modified_at ? dayjs(item.modified_at).format("HH:mm") : "",
    }));
  }, [workspace?.artifacts]);

  const handleSend = async (
    text: string,
    skills?: { slug: string; name: string }[]
  ) => {
    if (sending) return;
    setSending(true);
    setError(null);
    const optimisticId = crypto.randomUUID();
    const pendingId = crypto.randomUUID();
    pendingRef.current = { userId: optimisticId, agentId: pendingId, text };
    const controller = new AbortController();
    abortRef.current = controller;
    setMessages((prev) => [
      ...prev,
      { id: optimisticId, role: "user", content: text },
      { id: pendingId, role: "agent", content: "", streaming: true },
    ]);
    try {
      const result = await sendChat(
        text,
        activeId,
        roleId,
        skills?.map((s) => s.slug) ?? null,
        controller.signal
      );
      selectConversation(result.conversation_id);
      setMetaById((prev) => ({
        ...prev,
        [result.conversation_id]: {
          difficulty: result.difficulty,
          selectedTools: result.selected_tools,
          routeReason: result.route_reason,
          toolPlan: result.tool_plan_reason,
        },
      }));
      if (result.workspace) setWorkspace(result.workspace);
      setSelectedTurnId(result.turn_id);
      await refreshList();
      await loadConversation(result.conversation_id);
    } catch (err) {
      // 用户主动停止 / 撤回：提示取消，不当作错误。
      if (isAbortError(err)) {
        setError("已取消本次生成", "muted");
        return;
      }
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId && m.id !== pendingId));
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setSending(false);
    }
  };

  /** 后端是同步落库，停止 HTTP 请求后它可能仍在生成并稍后写入。
   *  这里轮询删除最近一轮，直到后端真正落库并被清掉（最多约 6.4s）。 */
  const cleanupLastTurn = useCallback(async (conversationId: string) => {
    for (let i = 0; i < 8; i++) {
      try {
        const res = await deleteLastTurn(conversationId);
        if (res.deleted > 0) return;
      } catch {
        /* 会话可能已被切换或删除，忽略 */
      }
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
  }, []);

  /** 主动停止 / 编辑 / 撤回：中止在途请求并清理气泡。 */
  const cancelCurrent = useCallback(
    (mode: "stop" | "edit" | "recall") => {
      const controller = abortRef.current;
      if (controller) controller.abort();
      abortRef.current = null;
      const pending = pendingRef.current;
      setMessages((prev) =>
        pending
          ? prev.filter((m) => m.id !== pending.userId && m.id !== pending.agentId)
          : prev
      );
      pendingRef.current = null;
      setSending(false);
      setError(null);
      if (mode === "edit" && pending) setRestoreText(pending.text);
      if (activeId) void cleanupLastTurn(activeId);
    },
    [activeId, cleanupLastTurn]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      const target = sessions.find((s) => s.id === id);
      if (!window.confirm(`确定删除会话「${target?.title ?? ""}」？工作区文件也会一并清除。`)) {
        return;
      }
      try {
        await deleteConversation(id);
        const rows = await refreshList();
        if (activeId === id) {
          const next = rows[0]?.id ?? null;
          selectConversation(next);
          if (!next) {
            setMessages([]);
            setWorkspace(null);
            setSelectedTurnId(null);
          }
        }
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [activeId, refreshList, selectConversation, sessions]
  );

  return (
    <>
      <SessionList
        sessions={filtered}
        activeId={activeId}
        onSelect={(id) => selectConversation(id)}
        onDelete={(id) => {
          void handleDelete(id);
        }}
        query={query}
        onQueryChange={setQuery}
      />
      <div className="flex min-h-0 min-w-0 flex-1">
        <ChatPanel
          session={session}
          messages={messages}
          insightOpen={insightOpen}
          onToggleInsight={() => setInsightOpen((v) => !v)}
          modelName={resolvedModelName}
          modelId={displayModel?.model_id ?? ""}
          roleName={activeRole?.name}
          contextPct={contextPct}
          contextTitle={contextTitle}
          sending={sending}
          error={error}
          errorTone={errorTone}
          meta={lastMeta}
          onStop={() => cancelCurrent("stop")}
          onEditMessage={() => cancelCurrent("edit")}
          onRecallMessage={() => cancelCurrent("recall")}
          restoreText={restoreText}
          onRestored={() => setRestoreText(null)}
          workspaceDir={workspace?.workspace_dir}
          conversationId={activeId}
          insightThread={insightThread}
          artifacts={artifacts}
          selectedTurnId={selectedTurnId}
          onSelectMessage={(tid) => setSelectedTurnId(tid)}
          onOpenWorkspace={() => {
            if (!activeId) return;
            void openConversationWorkspace(activeId).catch((err: unknown) => {
              setError(err instanceof Error ? err.message : String(err));
            });
          }}
          onOpenTrace={() => {
            if (!activeId) return;
            void openTraceWindow(activeId, selectedTurnId).catch((err: unknown) => {
              setError(err instanceof Error ? err.message : String(err));
            });
          }}
          onSend={(text, skills) => {
            void handleSend(text, skills);
          }}
        />
      </div>
    </>
  );
}
