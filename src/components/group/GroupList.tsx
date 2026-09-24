import { X } from "lucide-react";
import { cn } from "../../lib/cn";

export type GroupMemberItem = {
  id: string;
  name: string;
  /** 头像上的单字（无头像图时使用）。 */
  initial: string;
  colorClass: string;
  /** 群内身份，如 组长 / 成员。 */
  roleLabel: string;
  /** 角色头像图片 URL；为空则回落到 initial 色块。 */
  avatarUrl?: string;
};

/** 群组即群对话：一行 = 一个群对话。 */
export type GroupSummary = {
  id: string;
  name: string;
  colorClass: string;
  /** 群对话最后一条消息。 */
  preview: string;
  time: string;
  memberCount: number;
};

type GroupListProps = {
  groups: GroupSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDeleteGroup: (id: string) => void;
};

/** 群组视图左栏：整栏都是群对话列表，超出即滚动。 */
export function GroupList({
  groups,
  activeId,
  onSelect,
  onDeleteGroup,
}: GroupListProps) {
  return (
    <section className="flex w-[220px] min-w-0 shrink-0 flex-col overflow-hidden bg-list select-none">
      <div className="shrink-0 px-3 pt-4 pb-2">
        <p className="px-1 text-[11px] font-medium text-ink-400">我的群组</p>
      </div>

      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 pb-4">
        {groups.length === 0 ? (
          <p className="px-2 py-6 text-center text-[12.5px] text-ink-400">
            暂无群组
          </p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {groups.map((g) => {
              const active = g.id === activeId;
              return (
                <div
                  key={g.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelect(g.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelect(g.id);
                    }
                  }}
                  className={cn(
                    "group flex w-full min-w-0 cursor-pointer flex-col gap-0.5 rounded-2xl px-3 py-2.5 text-left transition-colors",
                    "focus-visible:outline-2 focus-visible:outline-brand-600",
                    active ? "bg-surface shadow-soft" : "hover:bg-tint/60"
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span
                      className={cn(
                        "flex size-6 shrink-0 items-center justify-center rounded-lg text-[11px] font-semibold text-white",
                        g.colorClass
                      )}
                    >
                      {g.name.slice(0, 1)}
                    </span>
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate text-[13px]",
                        active ? "font-medium text-ink-900" : "text-ink-700"
                      )}
                    >
                      {g.name}
                    </span>
                    <span className="shrink-0 text-[10.5px] text-ink-400">
                      {g.time}
                    </span>
                    <button
                      type="button"
                      title="删除群组"
                      aria-label={`删除群组 ${g.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteGroup(g.id);
                      }}
                      className={cn(
                        "flex size-5 shrink-0 items-center justify-center rounded-md text-ink-300 transition-opacity hover:bg-danger-50 hover:text-danger-600",
                        "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                        "focus-visible:outline-2 focus-visible:outline-brand-600"
                      )}
                    >
                      <X className="size-3" strokeWidth={2} />
                    </button>
                  </span>
                  <span className="flex items-baseline gap-2 pl-8">
                    <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-400">
                      {g.preview}
                    </span>
                    <span className="shrink-0 text-[10.5px] text-ink-400">
                      {g.memberCount} 人
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
