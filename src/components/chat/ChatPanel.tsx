import { PanelRight } from "lucide-react";
import { Badge } from "../ui/badge";
import { ScrollArea } from "../ui/scroll-area";
import { cn } from "../../lib/cn";
import { Composer } from "./Composer";
import type { SessionItem } from "./SessionList";
import {
  InsightPanel,
  type InsightArtifact,
  type InsightThreadItem,
} from "./InsightPanel";

export type ChatMessage = {
  id: string;
  role: "user" | "agent" | "system";
  content: string;
};

type ChatPanelProps = {
  session: SessionItem | null;
  messages: ChatMessage[];
  insightOpen: boolean;
  onToggleInsight: () => void;
  onSend?: (text: string) => void;
  onOpenWorkspace?: () => void;
  roleName?: string;
  modelName?: string;
  modelId?: string;
  contextPct?: number;
  contextTitle?: string;
  sending?: boolean;
  error?: string | null;
  workspaceDir?: string;
  insightThread?: InsightThreadItem[];
  artifacts?: InsightArtifact[];
  meta?: {
    difficulty?: string;
    selectedTools?: string[];
    routeReason?: string;
  };
};

export function ChatPanel({
  session,
  messages,
  insightOpen,
  onToggleInsight,
  onSend,
  onOpenWorkspace,
  roleName,
  modelName = "主对话模型",
  modelId = "",
  contextPct = 0,
  contextTitle = "上下文已用 0%",
  sending = false,
  error = null,
  workspaceDir,
  insightThread = [],
  artifacts = [],
  meta,
}: ChatPanelProps) {
  if (!session) {
    return (
      <section className="flex min-h-0 min-w-0 flex-1 items-center justify-center bg-surface">
        <p className="text-[13px] text-ink-400">选择或新建一个会话开始对话</p>
      </section>
    );
  }

  const subtitleParts = [
    roleName ?? null,
    workspaceDir ? `工作区 ${workspaceDir}` : null,
    meta?.difficulty ? `难度 ${meta.difficulty}` : null,
  ].filter(Boolean);

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-row bg-surface">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 px-6 pt-5 pb-4">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2.5">
              <h1 className="truncate text-[16px] font-semibold text-ink-900">
                {session.title}
              </h1>
              <Badge tone={session.tagTone ?? "neutral"}>{session.tagLabel}</Badge>
            </div>
            <p className="mt-0.5 truncate text-[12px] text-ink-400">
              {subtitleParts.join(" · ")}
            </p>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {["追踪", "归档", "打开工作区"].map((label) => (
              <button
                key={label}
                type="button"
                onClick={() => {
                  if (label === "打开工作区") onOpenWorkspace?.();
                }}
                className="rounded-lg px-2.5 py-1.5 text-[12px] text-ink-400 transition-colors hover:bg-tint hover:text-ink-700 focus-visible:outline-2 focus-visible:outline-brand-600"
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              onClick={onToggleInsight}
              title={insightOpen ? "收起执行洞察" : "展开执行洞察"}
              className={cn(
                "ml-1 flex size-8 items-center justify-center rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-brand-600",
                insightOpen
                  ? "bg-brand-50 text-brand-600"
                  : "text-ink-400 hover:bg-tint hover:text-ink-700"
              )}
            >
              <PanelRight className="size-4" strokeWidth={1.75} />
            </button>
          </div>
        </header>

        <ScrollArea className="flex-1 px-6 pb-2">
          <div className="mx-auto flex max-w-[760px] flex-col gap-4 pb-4">
            {messages.length === 0 ? (
              <p className="py-16 text-center text-[13px] text-ink-400">
                还没有消息。输入内容后发送即可开始。
              </p>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  className={cn(
                    "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-6 whitespace-pre-wrap",
                    m.role === "user"
                      ? "ml-auto bg-brand-600 text-white shadow-soft"
                      : m.role === "system"
                        ? "mx-auto bg-tint text-ink-500"
                        : "bg-tint text-ink-900"
                  )}
                >
                  {m.content}
                </div>
              ))
            )}
            {error ? (
              <p className="rounded-xl bg-red-50 px-3 py-2 text-[12.5px] text-red-700">
                {error}
              </p>
            ) : null}
          </div>
        </ScrollArea>

        <Composer
          modelName={modelName}
          modelId={modelId}
          contextPct={contextPct}
          contextTitle={contextTitle}
          sending={sending}
          onSend={(text) => onSend?.(text)}
        />
      </div>
      {insightOpen ? (
        <InsightPanel
          thread={insightThread}
          artifacts={artifacts}
          onClose={onToggleInsight}
        />
      ) : null}
    </section>
  );
}
