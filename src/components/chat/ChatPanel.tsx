import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, Check, Copy, PanelRight, Pencil, Undo2, User } from "lucide-react";
import { Badge } from "../ui/badge";
import { ScrollArea } from "../ui/scroll-area";
import { cn } from "../../lib/cn";
import { Composer } from "./Composer";
import { MarkdownMessage } from "./MarkdownMessage";
import { WaitingBubble } from "./WaitingBubble";
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
  onSend?: (text: string, skills?: { slug: string; name: string }[]) => void;
  onOpenWorkspace?: () => void;
  onOpenTrace?: () => void;
  roleName?: string;
  modelName?: string;
  modelId?: string;
  contextPct?: number;
  contextTitle?: string;
  sending?: boolean;
  error?: string | null;
  /** danger=失败（红）；muted=用户取消等提示（中性）。 */
  errorTone?: "danger" | "muted";
  workspaceDir?: string;
  conversationId?: string | null;
  insightThread?: InsightThreadItem[];
  artifacts?: InsightArtifact[];
  selectedTurnId?: string | null;
  onSelectMessage?: (turnId: string) => void;
  /** 主动停止当前生成（与 composer 的停止按钮一致）。 */
  onStop?: () => void;
  /** 编辑当前任务：停止生成并把原文回灌到输入框。 */
  onEditMessage?: () => void;
  /** 撤回当前任务：停止生成并撤销本轮消息。 */
  onRecallMessage?: () => void;
  /** 编辑时由父组件回灌到输入框的原文（null 表示无需回灌）。 */
  restoreText?: string | null;
  /** Composer 消费 restoreText 后回调，父组件据此清空。 */
  onRestored?: () => void;
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
  errorTone = "danger",
  workspaceDir,
  conversationId,
  insightThread = [],
  artifacts = [],
  selectedTurnId,
  onSelectMessage,
  onStop,
  onEditMessage,
  onRecallMessage,
  restoreText,
  onRestored,
  meta,
}: ChatPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const copyTimer = useRef<number | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // 当前正在生成的任务：列表里最后一条用户消息（仅在生成中显示编辑 / 撤回）。
  const lastUserIndex = messages.reduce(
    (acc, m, i) => (m.role === "user" ? i : acc),
    -1
  );

  const handleCopy = useCallback(async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // 退化方案：部分环境（非安全上下文）禁用异步剪贴板。
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        /* 忽略复制失败 */
      }
      document.body.removeChild(ta);
    }
    setCopiedId(id);
    if (copyTimer.current) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(
      () => setCopiedId((cur) => (cur === id ? null : cur)),
      1500
    );
  }, []);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const viewport =
      root.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]") ??
      (root.firstElementChild as HTMLElement | null);
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [messages]);

  useEffect(() => {
    return () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
    };
  }, []);

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
          <div className="mx-auto flex max-w-[760px] flex-col gap-0.5 pb-4">
            {messages.length === 0 ? (
              <p className="py-16 text-center text-[13px] text-ink-400">
                还没有消息。输入内容后发送即可开始。
              </p>
            ) : (
              messages.map((m, index) => {
                const isUser = m.role === "user";
                const isSystem = m.role === "system";
                const isAgent = m.role === "agent";
                const canInspect = isAgent && !!m.turnId;
                const selected = canInspect && m.turnId === selectedTurnId;
                // 当前正在生成的任务：最后一条用户消息，仅此时显示编辑 / 撤回。
                const isActiveTask = isUser && sending && index === lastUserIndex;
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
                        "group flex min-w-0 flex-col gap-1",
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
                          canInspect && "cursor-pointer transition-[box-shadow,background-color]",
                          selected
                            ? "ring-2 ring-brand-500/40 ring-offset-0"
                            : canInspect && "hover:ring-1 hover:ring-brand-500/25"
                        )}
                      >
                        {isAgent ? (
                          m.streaming && !m.content.trim() ? (
                            <WaitingBubble />
                          ) : (
                            <MarkdownMessage content={m.content} streaming={m.streaming} />
                          )
                        ) : (
                          m.content
                        )}
                      </div>
                      {isActiveTask ? (
                        <div
                          className={cn(
                            "flex items-center gap-1",
                            isUser ? "self-end" : "self-start"
                          )}
                        >
                          <button
                            type="button"
                            onClick={onEditMessage}
                            title="编辑这条消息"
                            className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] text-ink-400 transition-colors hover:bg-tint hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-brand-600"
                          >
                            <Pencil className="size-3.5" strokeWidth={1.75} />
                            编辑
                          </button>
                          <button
                            type="button"
                            onClick={onRecallMessage}
                            title="撤回这条消息"
                            className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] text-ink-400 transition-colors hover:bg-tint hover:text-danger-600 focus-visible:outline-2 focus-visible:outline-brand-600"
                          >
                            <Undo2 className="size-3.5" strokeWidth={1.75} />
                            撤回
                          </button>
                          {!m.streaming ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleCopy(m.id, m.content);
                              }}
                              title={copiedId === m.id ? "已复制" : "复制内容"}
                              aria-label={copiedId === m.id ? "已复制" : "复制内容"}
                              className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] text-ink-400 transition-colors hover:bg-tint hover:text-ink-700 focus-visible:outline-2 focus-visible:outline-brand-600"
                            >
                              {copiedId === m.id ? (
                                <Check className="size-3.5" strokeWidth={2} />
                              ) : (
                                <Copy className="size-3.5" strokeWidth={1.75} />
                              )}
                              {copiedId === m.id ? "已复制" : "复制"}
                            </button>
                          ) : null}
                        </div>
                      ) : !m.streaming ? (
                        <div
                          className={cn(
                            "flex items-center",
                            isUser ? "self-end" : "self-start"
                          )}
                        >
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleCopy(m.id, m.content);
                            }}
                            title={copiedId === m.id ? "已复制" : "复制内容"}
                            aria-label={copiedId === m.id ? "已复制" : "复制内容"}
                            className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] text-ink-400 transition-colors hover:bg-tint hover:text-ink-700 focus-visible:outline-2 focus-visible:outline-brand-600"
                          >
                            {copiedId === m.id ? (
                              <Check className="size-3.5" strokeWidth={2} />
                            ) : (
                              <Copy className="size-3.5" strokeWidth={1.75} />
                            )}
                            {copiedId === m.id ? "已复制" : "复制"}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })
            )}
            {error ? (
              <p
                className={cn(
                  "rounded-xl px-3 py-2 text-[12.5px]",
                  errorTone === "muted"
                    ? "bg-tint text-ink-500"
                    : "bg-red-50 text-red-700"
                )}
              >
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
          onSend={(text, skills) => onSend?.(text, skills)}
          onStop={onStop}
          restoreText={restoreText}
          onRestored={onRestored}
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
