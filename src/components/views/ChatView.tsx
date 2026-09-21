import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import "dayjs/locale/zh-cn";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createConversation,
  getConversation,
  getConversationWorkspace,
  listConversations,
  sendChat,
  type ConversationRecord,
  type ConversationWorkspace,
  type ChatMessageRecord,
} from "../../api";
import { ChatPanel, type ChatMessage } from "../chat/ChatPanel";
import { InsightPanel } from "../chat/InsightPanel";
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
  const [lastMeta, setLastMeta] = useState<{
    difficulty?: string;
    selectedTools?: string[];
    routeReason?: string;
  }>({});

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
          setLastMeta({});
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

  const handleSend = async (text: string) => {
    if (sending) return;
    setSending(true);
    setError(null);
    const optimisticId = crypto.randomUUID();
    setMessages((prev) => [...prev, { id: optimisticId, role: "user", content: text }]);
    try {
      const result = await sendChat(text, activeId);
      setActiveId(result.conversation_id);
      setLastMeta({
        difficulty: result.difficulty,
        selectedTools: result.selected_tools,
        routeReason: result.route_reason,
      });
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
          modelName={modelName}
          sending={sending}
          error={error}
          meta={lastMeta}
          workspaceDir={workspace?.workspace_dir}
          onSend={(text) => {
            void handleSend(text);
          }}
        />
        <InsightPanel open={insightOpen} workspace={workspace} meta={lastMeta} />
      </div>
    </>
  );
}
