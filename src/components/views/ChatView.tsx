import { useMemo, useState } from "react";
import { ChatPanel, type ChatMessage } from "../chat/ChatPanel";
import { InsightPanel } from "../chat/InsightPanel";
import { SessionList, type SessionItem } from "../chat/SessionList";

const PLACEHOLDER_SESSIONS: SessionItem[] = [
  {
    id: "s1",
    title: "欢迎使用 ChatVein",
    preview: "三栏布局架子已就绪，后续接入会话 API。",
    time: "刚刚",
    avatar: "C",
    colorClass: "bg-brand-600",
    tagLabel: "空闲",
    tagTone: "ok",
  },
  {
    id: "s2",
    title: "示例任务",
    preview: "演示会话列表与消息气泡样式。",
    time: "昨天",
    avatar: "示",
    colorClass: "bg-violet-400",
    tagLabel: "完成",
    tagTone: "neutral",
    unread: true,
  },
];

export function ChatView() {
  const [activeId, setActiveId] = useState<string | null>(PLACEHOLDER_SESSIONS[0].id);
  const [query, setQuery] = useState("");
  const [insightOpen, setInsightOpen] = useState(true);
  const [messagesById, setMessagesById] = useState<Record<string, ChatMessage[]>>({
    s1: [
      {
        id: "m1",
        role: "agent",
        content:
          "UI 架子已搭好：侧栏导航、会话列表、聊天区与执行洞察。交互控件基于 Radix 无头组件。",
      },
    ],
    s2: [],
  });

  const sessions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return PLACEHOLDER_SESSIONS;
    return PLACEHOLDER_SESSIONS.filter(
      (s) =>
        s.title.toLowerCase().includes(q) || s.preview.toLowerCase().includes(q)
    );
  }, [query]);

  const session = PLACEHOLDER_SESSIONS.find((s) => s.id === activeId) ?? null;
  const messages = (activeId && messagesById[activeId]) || [];

  return (
    <>
      <SessionList
        sessions={sessions}
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
          onSend={(text) => {
            if (!activeId) return;
            setMessagesById((prev) => ({
              ...prev,
              [activeId]: [
                ...(prev[activeId] ?? []),
                { id: crypto.randomUUID(), role: "user", content: text },
              ],
            }));
          }}
        />
        <InsightPanel open={insightOpen} />
      </div>
    </>
  );
}
