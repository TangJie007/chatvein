import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import "dayjs/locale/zh-cn";
import { Search, Trash2 } from "lucide-react";
import type { ConversationRecord } from "../../api";
import { cn } from "../../lib/cn";

dayjs.extend(relativeTime);
dayjs.locale("zh-cn");

const AVATAR_COLORS = [
  "bg-brand-500",
  "bg-violet-400",
  "bg-teal-400",
  "bg-peach-400",
  "bg-amber-400",
];

/** 后端会话记录 → 列表行。对话列表与群组左栏的群对话行共用。 */
export function toSessionItem(c: ConversationRecord): SessionItem {
  const title = c.title.trim() || "新会话";
  const idx =
    Math.abs([...c.id].reduce((acc, ch) => acc + ch.charCodeAt(0), 0)) %
    AVATAR_COLORS.length;
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

/** 会话状态 chip 配色；群组左栏的群对话行复用同一套口径。 */
export const SESSION_CHIP: Record<NonNullable<SessionItem["tagTone"]>, string> = {
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
  onDelete?: (id: string) => void;
  query: string;
  onQueryChange: (q: string) => void;
};

export function SessionList({
  sessions,
  activeId,
  onSelect,
  onDelete,
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
              <div
                key={s.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelect(s.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(s.id);
                  }
                }}
                className={cn(
                  "group mb-1 flex w-full min-w-0 cursor-pointer items-start gap-3 rounded-2xl px-3 py-3 text-left transition-colors",
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
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-ink-900">
                      {s.title}
                    </span>
                    {onDelete ? (
                      <button
                        type="button"
                        title="删除会话"
                        aria-label={`删除会话 ${s.title}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(s.id);
                        }}
                        className={cn(
                          "flex size-6 shrink-0 items-center justify-center rounded-md text-ink-300",
                          "opacity-0 transition-opacity hover:bg-danger-50 hover:text-danger-600",
                          "group-hover:opacity-100 focus-visible:opacity-100",
                          active && "opacity-100"
                        )}
                      >
                        <Trash2 className="size-3.5" strokeWidth={1.75} />
                      </button>
                    ) : null}
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium",
                        SESSION_CHIP[s.tagTone ?? "neutral"]
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
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
