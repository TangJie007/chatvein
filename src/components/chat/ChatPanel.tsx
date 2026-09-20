import { PanelRight, SendHorizontal } from "lucide-react";
import { useState } from "react";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { ScrollArea } from "../ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../ui/tooltip";
import { cn } from "../../lib/cn";
import type { SessionItem } from "./SessionList";

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
  modelName?: string;
};

export function ChatPanel({
  session,
  messages,
  insightOpen,
  onToggleInsight,
  onSend,
  modelName = "主对话模型",
}: ChatPanelProps) {
  const [draft, setDraft] = useState("");

  if (!session) {
    return (
      <section className="flex min-h-0 min-w-0 flex-1 items-center justify-center bg-surface">
        <p className="text-[13px] text-ink-400">选择或新建一个会话开始对话</p>
      </section>
    );
  }

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    onSend?.(text);
    setDraft("");
  };

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-row bg-surface">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 px-6 pb-4 pt-5">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2.5">
              <h1 className="truncate text-[16px] font-semibold text-ink-900">
                {session.title}
              </h1>
              <Badge tone={session.tagTone ?? "neutral"}>{session.tagLabel}</Badge>
            </div>
            <p className="mt-0.5 truncate text-[12px] text-ink-400">
              使用 {modelName} · 后续接入真实会话元数据
            </p>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={onToggleInsight}
                className={cn(
                  insightOpen
                    ? "bg-brand-50 text-brand-600"
                    : "text-ink-400 hover:text-ink-700"
                )}
                aria-label={insightOpen ? "收起执行洞察" : "展开执行洞察"}
              >
                <PanelRight className="size-4" strokeWidth={1.75} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {insightOpen ? "收起执行洞察" : "展开执行洞察"}
            </TooltipContent>
          </Tooltip>
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
                    "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-6",
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
          </div>
        </ScrollArea>

        <footer className="px-6 pb-5 pt-2">
          <div className="mx-auto flex max-w-[760px] items-end gap-2 rounded-2xl bg-tint/80 p-2 shadow-soft focus-within:bg-surface">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              rows={1}
              placeholder="输入消息，Enter 发送，Shift+Enter 换行"
              className="max-h-[212px] min-h-8 flex-1 resize-none bg-transparent px-2 py-1.5 text-[13.5px] leading-5 text-ink-900 placeholder:text-ink-400 focus:outline-none"
            />
            <Button
              variant="primary"
              size="icon"
              onClick={submit}
              disabled={!draft.trim()}
              aria-label="发送"
            >
              <SendHorizontal className="size-4" strokeWidth={1.75} />
            </Button>
          </div>
        </footer>
      </div>
    </section>
  );
}
