import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import "dayjs/locale/zh-cn";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createConversation,
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

dayjs.extend(relativeTime);
dayjs.locale("zh-cn");

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
  }));
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
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [insightOpen, setInsightOpen] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [workspace, setWorkspace] = useState<ConversationWorkspace | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    setMessages(toChatMessages(data.messages));
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
        if (rows.length > 0) {
          const first = rows[0]!.id;
          setActiveId((prev) => prev ?? first);
        }
      } catch {
        /* backend may still be starting */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshList]);

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
    if (!newRequestId) return;
    let cancelled = false;
    // StrictMode 会立刻清理再执行一次；推迟到清理之后再请求，避免点一次建两个。
    const timer = window.setTimeout(() => {
      void (async () => {
        if (cancelled) return;
        try {
          const created = await createConversation("");
          if (cancelled) return;
          await refreshListRef.current();
          if (cancelled) return;
          setActiveId(created.id);
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
  }, [newRequestId]);

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
    const steps: Extract<InsightThreadItem, { role: "trace" }>["trace"]["steps"] = [];
    if (lastMeta.routeReason) {
      steps.push({ kind: "thought", text: lastMeta.routeReason });
    }
    if (lastMeta.toolPlan) {
      steps.push({ kind: "thought", text: lastMeta.toolPlan });
    }
    for (const call of workspace?.tool_calls ?? []) {
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
      lastMeta.routeReason ||
      steps.find((s) => s.kind === "thought")?.text ||
      "完成本轮请求";
    return [{ role: "trace", trace: { goal, steps } }];
  }, [lastMeta.routeReason, lastMeta.toolPlan, workspace?.tool_calls]);

  const artifacts = useMemo<InsightArtifact[]>(() => {
    return (workspace?.artifacts ?? []).map((item) => ({
      type: artifactType(item.name),
      name: item.name,
      meta: artifactMeta(item.size_bytes),
      time: item.modified_at ? dayjs(item.modified_at).format("HH:mm") : "",
    }));
  }, [workspace?.artifacts]);

  const handleSend = async (text: string) => {
    if (sending) return;
    setSending(true);
    setError(null);
    const optimisticId = crypto.randomUUID();
    setMessages((prev) => [...prev, { id: optimisticId, role: "user", content: text }]);
    try {
      const result = await sendChat(text, activeId, roleId);
      setActiveId(result.conversation_id);
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
      await refreshList();
      await loadConversation(result.conversation_id);
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <SessionList
        sessions={filtered}
        activeId={activeId}
        onSelect={setActiveId}
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
          meta={lastMeta}
          workspaceDir={workspace?.workspace_dir}
          conversationId={activeId}
          insightThread={insightThread}
          artifacts={artifacts}
          onOpenWorkspace={() => {
            if (!activeId) return;
            void openConversationWorkspace(activeId).catch((err: unknown) => {
              setError(err instanceof Error ? err.message : String(err));
            });
          }}
          onSend={(text) => {
            void handleSend(text);
          }}
        />
      </div>
    </>
  );
}
