import { useEffect, useRef } from "react";
import { Bot, PanelRight, User } from "lucide-react";
import { Badge } from "../ui/badge";
import { ScrollArea } from "../ui/scroll-area";
import { cn } from "../../lib/cn";
import { Composer } from "./Composer";
import { MarkdownMessage } from "./MarkdownMessage";
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
  turnId?: string | null;
  /** 助手回复仍在追加 token 时为 true，用于未闭合 Markdown。 */
  streaming?: boolean;
  /** 本轮真实消耗的 token 数（后端采集，缺失为 null）。 */
  tokens?: number | null;
  /** 本轮真实耗时（毫秒）。 */
  durationMs?: number | null;
};

function formatTokens(tokens?: number | null): string {
  if (!tokens || tokens <= 0) return "—";
  if (tokens < 1000) return `${tokens} tokens`;
  const k = tokens / 1000;
  return `${k >= 10 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, "")}K tokens`;
}

function formatDuration(ms?: number | null): string {
  if (!ms || ms <= 0) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

type ChatPanelProps = {
  session: SessionItem | null;
  messages: ChatMessage[];
  insightOpen: boolean;
  onToggleInsight: () => void;
  onSend?: (text: string) => void;
  onOpenWorkspace?: () => void;
  onOpenTrace?: () => void;
  roleName?: string;
  modelName?: string;
  modelId?: string;
  contextPct?: number;
  contextTitle?: string;
  sending?: boolean;
  error?: string | null;
  workspaceDir?: string;
  conversationId?: string | null;
  insightThread?: InsightThreadItem[];
  artifacts?: InsightArtifact[];
  selectedTurnId?: string | null;
  onSelectMessage?: (turnId: string) => void;
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
  onOpenTrace,
  roleName,
  modelName = "主对话模型",
  modelId = "",
  contextPct = 0,
  contextTitle = "上下文已用 0%",
  sending = false,
  error = null,
  workspaceDir,
  conversationId,
  insightThread = [],
  artifacts = [],
  selectedTurnId,
  onSelectMessage,
  meta,
}: ChatPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const viewport =
      root.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]") ??
      (root.firstElementChild as HTMLElement | null);
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [messages]);

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
                  if (label === "追踪") {
                    if (!conversationId) return;
                    onOpenTrace?.();
                  }
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

        <ScrollArea ref={scrollRef} className="flex-1 px-6 pb-2">
          <div className="mx-auto flex max-w-[760px] flex-col gap-5 pb-4">
            {messages.length === 0 ? (
              <p className="py-16 text-center text-[13px] text-ink-400">
                还没有消息。输入内容后发送即可开始。
              </p>
            ) : (
              messages.map((m) => {
                const isUser = m.role === "user";
                const isSystem = m.role === "system";
                const isAgent = m.role === "agent";
                const canInspect = isAgent && !!m.turnId;
                const selected = canInspect && m.turnId === selectedTurnId;
                return (
                  <div
                    key={m.id}
                    className={cn(
                      "flex items-start gap-2.5",
                      isUser ? "flex-row-reverse" : "flex-row",
                      isSystem && "justify-center"
                    )}
                  >
                    {!isSystem ? (
                      <div
                        className={cn(
                          "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
                          isUser ? "bg-brand-600 text-white" : "bg-violet-500 text-white"
                        )}
                      >
                        {isUser ? (
                          <User className="size-4" strokeWidth={2} />
                        ) : (
                          <Bot className="size-4" strokeWidth={2} />
                        )}
                      </div>
                    ) : null}
                    <div
                      className={cn(
                        "flex min-w-0 flex-col gap-1",
                        isAgent ? "max-w-[min(92%,720px)]" : "max-w-[78%]"
                      )}
                    >
                      {isAgent && !m.streaming ? (
                        <div className="flex items-center gap-1.5 px-1 text-[11px] text-ink-400">
                          <span>{formatTokens(m.tokens)}</span>
                          <span aria-hidden="true">·</span>
                          <span>{formatDuration(m.durationMs)}</span>
                        </div>
                      ) : null}
                      <div
                        onClick={
                          canInspect
                            ? () => onSelectMessage?.(m.turnId as string)
                            : undefined
                        }
                        className={cn(
                          "rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-6",
                          !isAgent && "whitespace-pre-wrap",
                          isUser
                            ? "bg-brand-600 text-white shadow-soft"
                            : isSystem
                              ? "bg-tint text-ink-500 text-[12.5px]"
                              : "bg-tint text-ink-900",
                          canInspect && "cursor-pointer transition-shadow",
                          selected
                            ? "ring-2 ring-brand-400"
                            : canInspect && "hover:ring-1 hover:ring-brand-300"
                        )}
                      >
                        {isAgent ? (
                          <MarkdownMessage content={m.content} streaming={m.streaming} />
                        ) : (
                          m.content
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
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
          conversationId={session?.id}
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
