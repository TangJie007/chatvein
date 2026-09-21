import { Search } from "lucide-react";
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
  running?: boolean;
  unread?: boolean;
};

const CHIP: Record<NonNullable<SessionItem["tagTone"]>, string> = {
  neutral: "bg-tint text-ink-500",
  brand: "bg-brand-50 text-brand-700",
  ok: "bg-ok-50 text-ok-600",
  warn: "bg-warn-50 text-warn-600",
  danger: "bg-danger-50 text-danger-600",
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
    <section className="flex w-[220px] min-w-0 shrink-0 flex-col overflow-hidden bg-list select-none">
      <div className="px-3 pt-4 pb-2">
        <div className="flex items-center gap-2 rounded-xl bg-tint/80 px-3 py-2 text-ink-400 transition-colors focus-within:bg-surface focus-within:shadow-soft">
          <Search className="size-4 shrink-0" strokeWidth={1.75} />
          <input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="搜索会话"
            className="w-full min-w-0 bg-transparent text-[13px] text-ink-900 placeholder:text-ink-400 focus:outline-none"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 pb-4">
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
                  "group mb-1 flex w-full min-w-0 items-start gap-3 rounded-2xl px-3 py-3 text-left transition-colors",
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
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-ink-900">
                      {s.title}
                    </span>
                    <span
                      className={cn(
                        "ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium",
                        CHIP[s.tagTone ?? "neutral"]
                      )}
                    >
                      {s.running ? (
                        <span className="mr-1 inline-block size-1.5 animate-pulse rounded-full bg-brand-500 align-[-1px]" />
                      ) : null}
                      {s.tagLabel}
                    </span>
                  </span>
                  <span className="mt-0.5 flex min-w-0 items-baseline gap-2">
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate text-[12px]",
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
                {s.unread && !active ? (
                  <span className="mt-4 size-2 shrink-0 rounded-full bg-brand-500" />
                ) : null}
              </button>
            );
          })
        )}
      </div>
    </section>
  );
}
