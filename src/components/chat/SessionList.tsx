import { Search } from "lucide-react";
import { ScrollArea } from "../ui/scroll-area";
import { Input } from "../ui/input";
import { Badge } from "../ui/badge";
import { cn } from "../../lib/cn";

export type SessionItem = {
  id: string;
  title: string;
  preview: string;
  time: string;
  avatar: string;
  colorClass: string;
  tagLabel: string;
  tagTone?: "neutral" | "brand" | "ok" | "warn" | "danger";
  unread?: boolean;
};

type SessionListProps = {
  sessions: SessionItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
  query: string;
  onQueryChange: (q: string) => void;
};

export function SessionList({
  sessions,
  activeId,
  onSelect,
  query,
  onQueryChange,
}: SessionListProps) {
  return (
    <section className="flex w-[220px] shrink-0 flex-col bg-list select-none">
      <div className="px-3 pb-2 pt-4">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-ink-400"
            strokeWidth={1.75}
          />
          <Input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="搜索会话"
            className="pl-9"
          />
        </div>
      </div>

      <ScrollArea className="flex-1 px-3 pb-4">
        {sessions.length === 0 ? (
          <p className="px-2 py-6 text-center text-[12.5px] text-ink-400">暂无会话</p>
        ) : (
          sessions.map((s) => {
            const active = s.id === activeId;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onSelect(s.id)}
                className={cn(
                  "group mb-1 flex w-full items-start gap-3 rounded-2xl px-3 py-3 text-left transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-brand-600",
                  active ? "bg-surface shadow-soft" : "hover:bg-tint/60"
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg text-[11.5px] font-semibold text-white",
                    s.colorClass
                  )}
                >
                  {s.avatar}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[13.5px] font-medium text-ink-900">
                      {s.title}
                    </span>
                    <Badge tone={s.tagTone ?? "neutral"} className="ml-auto shrink-0">
                      {s.tagLabel}
                    </Badge>
                  </span>
                  <span className="mt-0.5 flex items-baseline gap-2">
                    <span
                      className={cn(
                        "truncate text-[12px]",
                        s.unread ? "font-medium text-ink-700" : "text-ink-400"
                      )}
                    >
                      {s.preview}
                    </span>
                    <span className="ml-auto shrink-0 text-[11px] text-ink-400">
                      {s.time}
                    </span>
                  </span>
                </span>
                {s.unread && !active && (
                  <span className="mt-4 size-2 shrink-0 rounded-full bg-brand-500" />
                )}
              </button>
            );
          })
        )}
      </ScrollArea>
    </section>
  );
}
